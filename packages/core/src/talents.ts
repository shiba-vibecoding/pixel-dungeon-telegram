import type { Hero, HeroClass, SubClass } from './actors';

/*
 * Talent (actors/hero/Talent.java): the points a hero spends on the four tiers, as Shattered has them.
 *
 * SEAM(talents): the talents stream owns the registry of all the classes' talents (the warrior's, the mage's,
 * the rogue's and the huntress's, their subclasses and abilities). This is the minimal one the classes stream
 * needs for the Duelist's and the Cleric's: the same names as Shattered's enum, the same icons (talent_icons.png)
 * and the same maximum points, and the same tier rules (Hero.talentPointsAvailable). Its stream adds its own
 * rows to TALENTS; nothing here is specific to two classes but the rows.
 */

export type TalentId = string;

/** Armour abilities (ArmorAbility), the classes stream's six: the Duelist's three and the Cleric's three. */
export type AbilityId = 'challenge' | 'elementalStrike' | 'feint' | 'ascendedForm' | 'trinity' | 'powerOfMany';

export interface TalentDef {
  id: TalentId;
  tier: 1 | 2 | 3 | 4;
  /** Talent.maxPoints: 2 in tiers 1 and 2, 3 in tier 3, 4 in tier 4. */
  max: number;
  /** The frame of talent_icons.png (16×16, 32 to a row). */
  icon: number;
  /** The class whose talent it is; tier 3 and 4 also name the subclass or the armour ability. */
  cls: HeroClass;
  sub?: SubClass;
  ability?: AbilityId;
}

const row = (cls: HeroClass, tier: 1 | 2, icons: Record<string, number>): TalentDef[] =>
  Object.entries(icons).map(([id, icon]) => ({ id, tier, max: 2, icon, cls }));
const sub = (cls: HeroClass, sub: SubClass | undefined, icons: Record<string, number>): TalentDef[] =>
  Object.entries(icons).map(([id, icon]) => ({ id, tier: 3 as const, max: 3, icon, cls, ...(sub ? { sub } : {}) }));
const abil = (cls: HeroClass, ability: AbilityId, icons: Record<string, number>): TalentDef[] =>
  Object.entries(icons).map(([id, icon]) => ({ id, tier: 4 as const, max: 4, icon, cls, ability }));

export const TALENTS: TalentDef[] = [
  // Duelist T1 and T2
  ...row('duelist', 1, { STRENGTHENING_MEAL: 128, ADVENTURERS_INTUITION: 129, PATIENT_STRIKE: 130, AGGRESSIVE_BARRIER: 131 }),
  ...row('duelist', 2, { FOCUSED_MEAL: 132, LIQUID_AGILITY: 133, WEAPON_RECHARGING: 134, LETHAL_HASTE: 135, SWIFT_EQUIP: 136 }),
  // Duelist T3, Champion T3, Monk T3
  ...sub('duelist', undefined, { PRECISE_ASSAULT: 137, DEADLY_FOLLOWUP: 138 }),
  ...sub('duelist', 'champion', { VARIED_CHARGE: 139, TWIN_UPGRADES: 140, COMBINED_LETHALITY: 141 }),
  ...sub('duelist', 'monk', { UNENCUMBERED_SPIRIT: 142, MONASTIC_VIGOR: 143, COMBINED_ENERGY: 144 }),
  // Duelist T4
  ...abil('duelist', 'challenge', { CLOSE_THE_GAP: 145, INVIGORATING_VICTORY: 146, ELIMINATION_MATCH: 147 }),
  ...abil('duelist', 'elementalStrike', { ELEMENTAL_REACH: 148, STRIKING_FORCE: 149, DIRECTED_POWER: 150 }),
  ...abil('duelist', 'feint', { FEIGNED_RETREAT: 151, EXPOSE_WEAKNESS: 152, COUNTER_ABILITY: 153 }),
  // Cleric T1 and T2
  ...row('cleric', 1, { SATIATED_SPELLS: 160, HOLY_INTUITION: 161, SEARING_LIGHT: 162, SHIELD_OF_LIGHT: 163 }),
  ...row('cleric', 2, { ENLIGHTENING_MEAL: 164, RECALL_INSCRIPTION: 165, SUNRAY: 166, DIVINE_SENSE: 167, BLESS: 168 }),
  // Cleric T3, Priest T3, Paladin T3
  ...sub('cleric', undefined, { CLEANSE: 169, LIGHT_READING: 170 }),
  ...sub('cleric', 'priest', { HOLY_LANCE: 171, HALLOWED_GROUND: 172, MNEMONIC_PRAYER: 173 }),
  ...sub('cleric', 'paladin', { LAY_ON_HANDS: 174, AURA_OF_PROTECTION: 175, WALL_OF_LIGHT: 176 }),
  // Cleric T4
  ...abil('cleric', 'ascendedForm', { DIVINE_INTERVENTION: 177, JUDGEMENT: 178, FLASH: 179 }),
  ...abil('cleric', 'trinity', { BODY_FORM: 180, MIND_FORM: 181, SPIRIT_FORM: 182 }),
  ...abil('cleric', 'powerOfMany', { BEAMING_RAY: 183, LIFE_LINK: 184, STASIS: 185 }),
];

/** HEROIC_ENERGY: the fourth talent of every armour ability; its icon is the class's own (Talent.icon). */
export const HEROIC_ENERGY: TalentDef = { id: 'HEROIC_ENERGY', tier: 4, max: 4, icon: 26, cls: 'warrior' };
export const HEROIC_ENERGY_ICON: Readonly<Record<HeroClass, number>> = { warrior: 26, mage: 58, rogue: 90, huntress: 122, duelist: 154, cleric: 186 };

const BY_ID = new Map<TalentId, TalentDef>([...TALENTS, HEROIC_ENERGY].map((def) => [def.id, def]));
export const talentDef = (id: TalentId): TalentDef | undefined => BY_ID.get(id);

/** Talent.tierLevelThresholds: tiers 1, 2, 3 and 4 open at levels 2, 7, 13 and 21 (a level early for the points). */
export const TIER_LEVELS: readonly number[] = [0, 2, 7, 13, 21, 31];

/** The armour abilities of a class (HeroClass.armorAbilities). */
export const ARMOR_ABILITIES: Readonly<Partial<Record<HeroClass, readonly AbilityId[]>>> = {
  duelist: ['challenge', 'elementalStrike', 'feint'],
  cleric: ['ascendedForm', 'trinity', 'powerOfMany'],
};

/** The talents a hero can spend points on in a tier: Talent.initClassTalents, initSubclassTalents and initArmorTalents. */
export function talentsOfTier(hero: Hero, tier: 1 | 2 | 3 | 4): TalentDef[] {
  if (tier === 4) {
    if (!hero.armorAbility) return [];
    return [...TALENTS.filter((def) => def.tier === 4 && def.ability === hero.armorAbility), { ...HEROIC_ENERGY, icon: HEROIC_ENERGY_ICON[hero.heroClass] }];
  }
  return TALENTS.filter((def) => def.tier === tier && def.cls === hero.heroClass && (def.sub === undefined || def.sub === hero.subclass));
}

/** Hero.pointsInTalent. */
export const pointsIn = (hero: Hero, id: TalentId): number => hero.talents?.[id] ?? 0;
/** Hero.hasTalent. */
export const hasTalent = (hero: Hero, id: TalentId): boolean => pointsIn(hero, id) > 0;

/** Hero.talentPointsSpent. */
export const pointsSpent = (hero: Hero, tier: 1 | 2 | 3 | 4): number =>
  talentsOfTier(hero, tier).reduce((total, def) => total + pointsIn(hero, def.id), 0);

/** Hero.bonusTalentPoints: a potion of divine inspiration gave a tier two more. */
export function bonusPoints(hero: Hero, tier: 1 | 2 | 3 | 4): number {
  if (hero.lvl < TIER_LEVELS[tier]! - 1 || (tier === 3 && !hero.subclass) || (tier === 4 && !hero.armorAbility)) return 0;
  return hero.buffs?.inspired?.includes(tier) ? 2 : 0;
}

/** Hero.talentPointsAvailable. */
export function pointsAvailable(hero: Hero, tier: 1 | 2 | 3 | 4): number {
  if (hero.lvl < TIER_LEVELS[tier]! - 1 || (tier === 3 && !hero.subclass) || (tier === 4 && !hero.armorAbility)) return 0;
  const spent = pointsSpent(hero, tier);
  if (hero.lvl >= TIER_LEVELS[tier + 1]!) return TIER_LEVELS[tier + 1]! - TIER_LEVELS[tier]! - spent + bonusPoints(hero, tier);
  return 1 + hero.lvl - TIER_LEVELS[tier]! - spent + bonusPoints(hero, tier);
}

/** Whether any tier has a point to spend (the hero's «+»). */
export const hasFreePoints = (hero: Hero): boolean => ([1, 2, 3, 4] as const).some((tier) => pointsAvailable(hero, tier) > 0);

/** Why a point cannot go into a talent, or null (WndInfoTalent's «upgrade»). */
export function talentProblem(hero: Hero, id: TalentId): string | null {
  const def = talentDef(id);
  if (!def) return 'no such talent';
  const open = talentsOfTier(hero, def.tier).some((d) => d.id === id);
  if (!open) return 'no such talent';
  if (pointsIn(hero, id) >= def.max) return 'the talent is learned fully';
  return pointsAvailable(hero, def.tier) > 0 ? null : 'no talent points';
}
