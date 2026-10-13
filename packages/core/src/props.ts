import type { MobKind } from './actors';
import type { Char } from './floor';

/*
 * Char.Property: what kind of creature a character is, as Shattered tells
 * them apart — bosses and minibosses, the undead, demons, things of stone or
 * metal, the fiery, the icy, the acidic, the electric, the large (who cannot
 * squeeze through a doorway or a corridor), the immovable, the static.
 * The monsters' as Shattered gives them; a champion giant is large too.
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
  fetidRat: ['miniboss', 'demonic'],
  gnollTrickster: ['miniboss'],
  greatCrab: ['miniboss'],
  curse: ['miniboss', 'undead'],
  causticSlime: ['acidic'],
  skeleton: ['undead', 'inorganic'],
  necroSkeleton: ['undead', 'inorganic'],
  thief: ['undead'],
  bandit: ['undead'],
  dm100: ['electric', 'inorganic'],
  guard: ['undead'],
  necromancer: ['undead'],
  spectralNecromancer: ['undead'],
  dm200: ['inorganic', 'large'],
  dm201: ['inorganic', 'large', 'immovable'],
  ghoul: ['undead'],
  elemental: ['fiery'],
  frostElemental: ['icy'],
  shockElemental: ['electric'],
  monk: ['undead'],
  senior: ['undead'],
  warlock: ['undead'],
  golem: ['inorganic', 'large'],
  succubus: ['demonic'],
  eye: ['demonic'],
  scorpio: ['demonic'],
  acidic: ['demonic', 'acidic'],
  ripper: ['demonic', 'undead'],
  spawner: ['immovable', 'miniboss', 'demonic', 'static'],
  wraith: ['undead', 'inorganic'],
  tormentedSpirit: ['undead', 'inorganic'],
  mimic: ['demonic'],
  goldenMimic: ['demonic'],
  crystalMimic: ['demonic'],
  ebonyMimic: ['demonic'],
  statue: ['inorganic'],
  armoredStatue: ['inorganic'],
  shopkeeper: ['immovable'],
  impShopkeeper: ['immovable'],
  imp: ['immovable'],
  wandmaker: ['immovable'],
  blacksmith: ['immovable'],
  ghost: ['large'],
};

/** Char.properties; a hero has none; a giant champion is large (Char.properties with ChampionEnemy.Giant). */
export function propertiesOf(char: Char): readonly Property[] {
  if (!('kind' in char)) return [];
  const own = PROPERTIES[char.kind] ?? [];
  return char.champion === 'giant' && !own.includes('large') ? [...own, 'large'] : own;
}

/** Char.hasProp. */
export const hasProp = (char: Char | undefined, property: Property): boolean => char !== undefined && propertiesOf(char).includes(property);
