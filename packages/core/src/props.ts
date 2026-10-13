import type { MobKind } from './actors';
import type { Char } from './floor';
import type { ItemKind } from './items';

/*
 * Char.Property: what kind of creature a character is, as Shattered tells
 * them apart — bosses, the undead, demons, things of stone or metal, the
 * fiery, the icy, the acidic, the electric, the large, the immovable — and
 * the harm each kind resists (half of it) or ignores.
 *
 * Seam for the mobs stream: the table below gives Shattered's properties to
 * the monsters there are now; Shattered's roster fills it with its own.
 */

export type Property =
  | 'boss' | 'miniboss' | 'bossMinion' | 'undead' | 'demonic' | 'inorganic' | 'fiery' | 'icy' | 'acidic' | 'electric' | 'large'
  | 'immovable' | 'static';

const PROPERTIES: Partial<Record<MobKind, readonly Property[]>> = {
  goo: ['boss', 'demonic', 'acidic'],
  tengu: ['boss'],
  dm300: ['boss', 'inorganic', 'large'],
  king: ['boss', 'undead'],
  undead: ['bossMinion', 'undead'],
  yog: ['boss', 'immovable', 'demonic', 'static'],
  rottingFist: ['boss', 'demonic', 'acidic'],
  burningFist: ['boss', 'demonic', 'fiery'],
  larva: ['demonic', 'bossMinion'],
  // Shattered's bosses' own (YogFist's four others, Pylon, DwarfKing's Ghoul).
  soiledFist: ['boss', 'demonic'],
  rustedFist: ['boss', 'demonic', 'large', 'inorganic'],
  brightFist: ['boss', 'demonic', 'electric'],
  darkFist: ['boss', 'demonic'],
  pylon: ['miniboss', 'bossMinion', 'inorganic', 'electric', 'immovable', 'static'],
  ghoul: ['undead'],
  fetidRat: ['miniboss', 'demonic'],
  curse: ['miniboss', 'undead'],
  skeleton: ['undead', 'inorganic'],
  thief: ['undead'],
  bandit: ['undead'],
  monk: ['undead'],
  senior: ['undead'],
  warlock: ['undead'],
  wraith: ['undead', 'inorganic'],
  golem: ['inorganic', 'large'],
  statue: ['inorganic'],
  elemental: ['fiery'],
  succubus: ['demonic'],
  eye: ['demonic'],
  scorpio: ['demonic'],
  acidic: ['demonic', 'acidic'],
  mimic: ['demonic'],
  shopkeeper: ['immovable'],
  impShopkeeper: ['immovable'],
  imp: ['immovable'],
  wandmaker: ['immovable'],
  blacksmith: ['immovable'],
  ghost: ['large'],
  ward: ['immovable', 'inorganic'],
  guardian: ['inorganic'],
  lotus: ['immovable', 'static'],
};

/** Char.properties; a hero has none. */
export function propertiesOf(char: Char): readonly Property[] {
  if (!('kind' in char)) return [];
  const own = PROPERTIES[char.kind] ?? [];
  // A boss's summons (the King's court, Yog's larvae: Property.BOSS_MINION), and the King on his throne (IMMOVABLE in phase two).
  const extra: Property[] = [];
  if (char.minion && !own.includes('bossMinion')) extra.push('bossMinion');
  if (char.kind === 'king' && char.boss?.phase === 2) extra.push('immovable');
  return extra.length > 0 ? [...own, ...extra] : own;
}

/** Char.hasProp. */
export const hasProp = (char: Char | undefined, property: Property): boolean => char !== undefined && propertiesOf(char).includes(property);

/** What harms a character: a wand's kind, or one of the conditions it may be put under. */
export type Harm =
  | ItemKind | 'burning' | 'chill' | 'frost' | 'ooze' | 'corrosion' | 'corruption' | 'paralysis' | 'amok' | 'charm' | 'terror' | 'slow'
  | 'vertigo' | 'roots' | 'blindness' | 'doom' | 'sleep' | 'poison' | 'toxic' | 'bleeding';

/** Property.immunities, and the monsters' own (Char.immunities). */
export function isImmune(char: Char, harm: Harm): boolean {
  const props = propertiesOf(char);
  for (const prop of props) {
    switch (prop) {
      case 'boss':
      case 'miniboss':
        if (harm === 'corruption') return true;
        break;
      case 'inorganic':
        if (harm === 'bleeding' || harm === 'toxic' || harm === 'poison') return true;
        break;
      case 'fiery':
        if (harm === 'burning') return true;
        break;
      case 'icy':
        if (harm === 'frost' || harm === 'chill') return true;
        break;
      case 'acidic':
        if (harm === 'ooze') return true;
        break;
      case 'immovable':
        if (harm === 'vertigo') return true;
        break;
      case 'static':
        if (['corruption', 'terror', 'amok', 'charm', 'sleep', 'paralysis', 'frost', 'chill', 'slow'].includes(harm)) return true;
        break;
    }
  }
  if (!('kind' in char)) return false;
  switch (char.kind) {
    // The earth guardian and the wards are immune to the ally buffs (AllyBuff); wards know no sleep, fear or vertigo.
    case 'guardian':
      return harm === 'corruption';
    case 'ward':
      return harm === 'corruption' || harm === 'sleep' || harm === 'terror' || harm === 'vertigo';
    case 'lotus':
      return harm === 'doom';
    case 'piranha':
      return harm === 'burning';
    case 'succubus':
      return harm === 'charm';
    case 'tengu':
      return harm === 'roots' || harm === 'blindness' || harm === 'terror';
    case 'dm300':
      return harm === 'sleep';
    default:
      return false;
  }
}

/** Char.resist: the share of a harm that gets through (Property.resistances, and the monsters' own). */
export function resistance(char: Char, harm: Harm): number {
  let share = 1;
  for (const prop of propertiesOf(char)) {
    if (prop === 'fiery' && harm === 'wand.fireblast') share *= 0.5;
    if (prop === 'icy' && harm === 'wand.frost') share *= 0.5;
    if (prop === 'acidic' && harm === 'corrosion') share *= 0.5;
    if (prop === 'electric' && harm === 'wand.lightning') share *= 0.5;
  }
  if ('kind' in char) {
    if (char.kind === 'eye' && harm === 'wand.disintegration') share *= 0.5;
    if (char.kind === 'dm300' && ['terror', 'charm', 'vertigo', 'chill', 'frost', 'roots', 'slow'].includes(harm)) share *= 0.5;
  }
  return share;
}
