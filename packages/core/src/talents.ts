import type { Hero, HeroClass } from './actors';

/*
 * Talents, as far as the abilities stream needs them (Talent.java): the tier 4 talents each armour ability
 * brings, the heroic energy every ability has, and the points to put in them. A minimal registry: the talents
 * stream owns tiers 1 to 3 and the talents window, and widens `Talent`, `TALENTS` and the per-tier helpers
 * here when it merges (every tier 1 to 3 talent is one entry of the same shape).
 *
 * A hero's talents are `Hero.talents`: points by talent (absent: none).
 */

/** The tier 4 talents of the twelve armour abilities (the duelist's, the cleric's and the rat king's are the classes stream's). */
export const ARMOR_TALENTS = [
  // Heroic Leap
  'bodySlam', 'impactWave', 'doubleJump',
  // Shockwave
  'expandingWave', 'strikingWave', 'shockForce',
  // Endure
  'sustainedRetribution', 'shrugItOff', 'evenTheOdds',
  // Elemental Blast
  'blastRadius', 'elementalPower', 'reactiveBarrier',
  // Wild Magic
  'wildPower', 'fireEverything', 'conservedMagic',
  // Warp Beacon
  'telefrag', 'remoteBeacon', 'longrangeWarp',
  // Smoke Bomb
  'hastyRetreat', 'bodyReplacement', 'shadowStep',
  // Death Mark
  'fearTheReaper', 'deathlyDurability', 'doubleMark',
  // Shadow Clone
  'shadowBlade', 'clonedArmor', 'perfectCopy',
  // Spectral Blades
  'fanOfBlades', 'projectingBlades', 'spiritBlades',
  // Nature's Power
  'growingPower', 'naturesWrath', 'wildMomentum',
  // Spirit Hawk
  'eagleEye', 'goForTheEyes', 'swiftSpirit',
  // universal
  'heroicEnergy',
] as const;

export type ArmorTalent = (typeof ARMOR_TALENTS)[number];

/** Every talent (the talents stream adds tiers 1 to 3 to this union). */
export type Talent = ArmorTalent;

export interface TalentInfo {
  tier: 1 | 2 | 3 | 4;
  /** Talent.maxPoints: 2 for tiers 1 and 2, 3 for tier 3, 4 for tier 4. */
  maxPoints: number;
  /** The frame in talent_icons.png (Talent's icon id). */
  icon: number;
}

const t4 = (icon: number): TalentInfo => ({ tier: 4, maxPoints: 4, icon });

/** Talent(icon, maxPoints) of each tier 4 talent. */
export const TALENTS: Readonly<Record<Talent, TalentInfo>> = {
  bodySlam: t4(17), impactWave: t4(18), doubleJump: t4(19),
  expandingWave: t4(20), strikingWave: t4(21), shockForce: t4(22),
  sustainedRetribution: t4(23), shrugItOff: t4(24), evenTheOdds: t4(25),
  blastRadius: t4(49), elementalPower: t4(50), reactiveBarrier: t4(51),
  wildPower: t4(52), fireEverything: t4(53), conservedMagic: t4(54),
  telefrag: t4(55), remoteBeacon: t4(56), longrangeWarp: t4(57),
  hastyRetreat: t4(81), bodyReplacement: t4(82), shadowStep: t4(83),
  fearTheReaper: t4(84), deathlyDurability: t4(85), doubleMark: t4(86),
  shadowBlade: t4(87), clonedArmor: t4(88), perfectCopy: t4(89),
  fanOfBlades: t4(113), projectingBlades: t4(114), spiritBlades: t4(115),
  growingPower: t4(116), naturesWrath: t4(117), wildMomentum: t4(118),
  eagleEye: t4(119), goForTheEyes: t4(120), swiftSpirit: t4(121),
  heroicEnergy: t4(26),
};

/** Talent.icon: the heroic energy is drawn by the hero's class (its frame, 26 for the warrior, then 58, 90, 122 and the classes' 154, 186). */
export const HEROIC_ENERGY_ICON: Readonly<Partial<Record<HeroClass, number>>> = { warrior: 26, mage: 58, rogue: 90, huntress: 122 };
export const talentIcon = (talent: Talent, heroClass: HeroClass): number =>
  talent === 'heroicEnergy' ? HEROIC_ENERGY_ICON[heroClass] ?? 26 : TALENTS[talent].icon;

/** Hero.pointsInTalent. */
export const pointsInTalent = (hero: Hero, talent: Talent): number => hero.talents?.[talent] ?? 0;

/** Hero.hasTalent: at least a point in it. */
export const hasTalent = (hero: Hero, talent: Talent): boolean => pointsInTalent(hero, talent) > 0;

/** Talent.tierLevelThresholds: tiers 1 to 4 start at levels 2, 7, 13 and 21 (the sixth is the ceiling). */
export const TIER_LEVEL_THRESHOLDS: readonly number[] = [0, 2, 7, 13, 21, 31];

/** Hero.talentPointsSpent. */
export function talentPointsSpent(hero: Hero, tier: number): number {
  let total = 0;
  for (const talent of Object.keys(hero.talents ?? {}) as Talent[]) {
    if (TALENTS[talent]?.tier === tier) total += hero.talents![talent] ?? 0;
  }
  return total;
}

/** Hero.bonusTalentPoints: a potion of divine inspiration gave a tier two points more. */
export function bonusTalentPoints(hero: Hero, tier: number): number {
  if (hero.lvl < TIER_LEVEL_THRESHOLDS[tier]! - 1 || (tier === 3 && !hero.subclass) || (tier === 4 && !hero.ability)) return 0;
  return hero.buffs?.inspired?.includes(tier) ? 2 : 0;
}

/**
 * Hero.talentPointsAvailable: a point a level from the tier's threshold, up to the next tier's (tier 3 needs a
 * subclass, tier 4 an armour ability).
 */
export function talentPointsAvailable(hero: Hero, tier: number): number {
  if (hero.lvl < TIER_LEVEL_THRESHOLDS[tier]! - 1 || (tier === 3 && !hero.subclass) || (tier === 4 && !hero.ability)) return 0;
  const spent = talentPointsSpent(hero, tier);
  if (hero.lvl >= TIER_LEVEL_THRESHOLDS[tier + 1]!) {
    return TIER_LEVEL_THRESHOLDS[tier + 1]! - TIER_LEVEL_THRESHOLDS[tier]! - spent + bonusTalentPoints(hero, tier);
  }
  return 1 + hero.lvl - TIER_LEVEL_THRESHOLDS[tier]! - spent + bonusTalentPoints(hero, tier);
}

/** Hero.upgradeTalent's check: a talent the hero has, below its maximum, with a point to spend in its tier. */
export function upgradeTalentProblem(hero: Hero, talent: unknown): string | null {
  if (typeof talent !== 'string' || !(talent in TALENTS)) return 'no such talent';
  const info = TALENTS[talent as Talent];
  if (!talentsOf(hero).includes(talent as Talent)) return 'that is not one of your talents';
  if (pointsInTalent(hero, talent as Talent) >= info.maxPoints) return 'that talent is at its best';
  return talentPointsAvailable(hero, info.tier) > 0 ? null : 'no talent points to spend';
}

/** Hero.upgradeTalent: a point more. */
export function upgradeTalent(hero: Hero, talent: Talent): void {
  (hero.talents ??= {})[talent] = pointsInTalent(hero, talent) + 1;
}

/** The talents a hero can put points in at tier 4: the four of their armour ability (Talent.initArmorTalents). */
export function talentsOf(hero: Hero): Talent[] {
  return hero.ability ? armorTalents(hero.ability) : [];
}

/** ArmorAbility.talents(): the three of each ability, then the heroic energy. */
export const ABILITY_TALENTS: Readonly<Record<AbilityKind, readonly [Talent, Talent, Talent, Talent]>> = {
  heroicLeap: ['bodySlam', 'impactWave', 'doubleJump', 'heroicEnergy'],
  shockwave: ['expandingWave', 'strikingWave', 'shockForce', 'heroicEnergy'],
  endure: ['sustainedRetribution', 'shrugItOff', 'evenTheOdds', 'heroicEnergy'],
  elementalBlast: ['blastRadius', 'elementalPower', 'reactiveBarrier', 'heroicEnergy'],
  wildMagic: ['wildPower', 'fireEverything', 'conservedMagic', 'heroicEnergy'],
  warpBeacon: ['telefrag', 'remoteBeacon', 'longrangeWarp', 'heroicEnergy'],
  smokeBomb: ['hastyRetreat', 'bodyReplacement', 'shadowStep', 'heroicEnergy'],
  deathMark: ['fearTheReaper', 'deathlyDurability', 'doubleMark', 'heroicEnergy'],
  shadowClone: ['shadowBlade', 'clonedArmor', 'perfectCopy', 'heroicEnergy'],
  spectralBlades: ['fanOfBlades', 'projectingBlades', 'spiritBlades', 'heroicEnergy'],
  naturesPower: ['growingPower', 'naturesWrath', 'wildMomentum', 'heroicEnergy'],
  spiritHawk: ['eagleEye', 'goForTheEyes', 'swiftSpirit', 'heroicEnergy'],
};

export const armorTalents = (ability: AbilityKind): Talent[] => [...ABILITY_TALENTS[ability]];

/** The armour abilities of the four classes (the abilities module has their rules). */
export type AbilityKind =
  | 'heroicLeap' | 'shockwave' | 'endure'
  | 'elementalBlast' | 'wildMagic' | 'warpBeacon'
  | 'smokeBomb' | 'deathMark' | 'shadowClone'
  | 'spectralBlades' | 'naturesPower' | 'spiritHawk';
