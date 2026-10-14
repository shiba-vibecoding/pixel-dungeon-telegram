import type { Hero, SubClass } from '../actors';
import type { HeroClass } from '../heroclass';

/*
 * Shattered Pixel Dungeon's talents (actors/hero/Talent.java) for the four classes: tiers 1 to 3 of each class and
 * the subclasses' third tier, and the fourth tier's, which the armour abilities bring (the abilities stream's entries
 * are folded in here: ARMOR_TALENTS, ABILITY_TALENTS). A talent is named as in the original's message keys (hearty_meal), its icon is its frame in talent_icons.png.
 *
 * A hero keeps its talents as four tiers of {talent: points}, in the order Shattered lists them, plus the talents
 * metamorphosis swapped (Hero.talents, Hero.metamorphedTalents).
 */

export type TalentId =
  // Warrior T1, T2, T3; Berserker; Gladiator
  | 'hearty_meal' | 'veterans_intuition' | 'provoked_anger' | 'iron_will'
  | 'iron_stomach' | 'liquid_willpower' | 'runic_transference' | 'lethal_momentum' | 'improvised_projectiles'
  | 'hold_fast' | 'strongman'
  | 'endless_rage' | 'deathless_fury' | 'enraged_catalyst'
  | 'cleave' | 'lethal_defense' | 'enhanced_combo'
  // Mage; Battlemage; Warlock
  | 'empowering_meal' | 'scholars_intuition' | 'lingering_magic' | 'backup_barrier'
  | 'energizing_meal' | 'inscribed_power' | 'wand_preservation' | 'arcane_vision' | 'shield_battery'
  | 'desperate_power' | 'ally_warp'
  | 'empowered_strike' | 'mystical_charge' | 'excess_charge'
  | 'soul_eater' | 'soul_siphon' | 'necromancers_minions'
  // Rogue; Assassin; Freerunner
  | 'cached_rations' | 'thiefs_intuition' | 'sucker_punch' | 'protective_shadows'
  | 'mystical_meal' | 'inscribed_stealth' | 'wide_search' | 'silent_steps' | 'rogues_foresight'
  | 'enhanced_rings' | 'light_cloak'
  | 'enhanced_lethality' | 'assassins_reach' | 'bounty_hunter'
  | 'evasive_armor' | 'projectile_momentum' | 'speedy_stealth'
  // Huntress; Sniper; Warden
  | 'natures_bounty' | 'survivalists_intuition' | 'followup_strike' | 'natures_aid'
  | 'invigorating_meal' | 'liquid_nature' | 'rejuvenating_steps' | 'heightened_senses' | 'durable_projectiles'
  | 'point_blank' | 'seer_shot'
  | 'farsight' | 'shared_enchantment' | 'shared_upgrades'
  | 'durable_tips' | 'barkskin' | 'shielding_dew'
  // Duelist; Champion; Monk
  | 'strengthening_meal' | 'adventurers_intuition' | 'patient_strike' | 'aggressive_barrier'
  | 'focused_meal' | 'liquid_agility' | 'weapon_recharging' | 'lethal_haste' | 'swift_equip'
  | 'precise_assault' | 'deadly_followup'
  | 'varied_charge' | 'twin_upgrades' | 'combined_lethality'
  | 'unencumbered_spirit' | 'monastic_vigor' | 'combined_energy'
  // Cleric; Priest; Paladin
  | 'satiated_spells' | 'holy_intuition' | 'searing_light' | 'shield_of_light'
  | 'enlightening_meal' | 'recall_inscription' | 'sunray' | 'divine_sense' | 'bless'
  | 'cleanse' | 'light_reading'
  | 'holy_lance' | 'hallowed_ground' | 'mnemonic_prayer'
  | 'lay_on_hands' | 'aura_of_protection' | 'wall_of_light'
  | ArmorTalent;

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
  // Challenge, Elemental Strike, Feint (the classes stream's)
  'closeTheGap', 'invigoratingVictory', 'eliminationMatch',
  'elementalReach', 'strikingForce', 'directedPower',
  'feignedRetreat', 'exposeWeakness', 'counterAbility',
  // Ascended Form, Trinity, Power of Many
  'divineIntervention', 'judgement', 'flash',
  'bodyForm', 'mindForm', 'spiritForm',
  'beamingRay', 'lifeLink', 'stasis',
  // universal
  'heroicEnergy',
] as const;

export type ArmorTalent = (typeof ARMOR_TALENTS)[number];

/** Every talent (the abilities stream's name for TalentId). */
export type Talent = TalentId;

/** The armour abilities of the four classes (the abilities module has their rules). */
export type AbilityKind =
  | 'heroicLeap' | 'shockwave' | 'endure'
  | 'elementalBlast' | 'wildMagic' | 'warpBeacon'
  | 'smokeBomb' | 'deathMark' | 'shadowClone'
  | 'spectralBlades' | 'naturesPower' | 'spiritHawk'
  /* the Duelist's and the Cleric's (classes/) */
  | 'challenge' | 'elementalStrike' | 'feint' | 'ascendedForm' | 'trinity' | 'powerOfMany';

export interface TalentDef {
  /** Talent.icon: the frame in talent_icons.png (32 to a row). */
  icon: number;
  /** Talent.maxPoints. */
  max: number;
  /** The tier it belongs to, 1 to 4. */
  tier: 1 | 2 | 3 | 4;
}

/** Talent(int icon): two points at most; the third tier's are Talent(icon, 3). */
const t1 = (icon: number): TalentDef => ({ icon, max: 2, tier: 1 });
const t2 = (icon: number): TalentDef => ({ icon, max: 2, tier: 2 });
const t3 = (icon: number): TalentDef => ({ icon, max: 3, tier: 3 });
const c3 = t3;
/** Talent(icon, 4): the fourth tier's. */
const t4 = (icon: number): TalentDef => ({ icon, max: 4, tier: 4 });

export const TALENTS: Readonly<Record<TalentId, TalentDef>> = {
  hearty_meal: t1(0), veterans_intuition: t1(1), provoked_anger: t1(2), iron_will: t1(3),
  iron_stomach: t2(4), liquid_willpower: t2(5), runic_transference: t2(6), lethal_momentum: t2(7), improvised_projectiles: t2(8),
  hold_fast: t3(9), strongman: t3(10),
  endless_rage: c3(11), deathless_fury: c3(12), enraged_catalyst: c3(13),
  cleave: c3(14), lethal_defense: c3(15), enhanced_combo: c3(16),

  empowering_meal: t1(32), scholars_intuition: t1(33), lingering_magic: t1(34), backup_barrier: t1(35),
  energizing_meal: t2(36), inscribed_power: t2(37), wand_preservation: t2(38), arcane_vision: t2(39), shield_battery: t2(40),
  desperate_power: t3(41), ally_warp: t3(42),
  empowered_strike: c3(43), mystical_charge: c3(44), excess_charge: c3(45),
  soul_eater: c3(46), soul_siphon: c3(47), necromancers_minions: c3(48),

  cached_rations: t1(64), thiefs_intuition: t1(65), sucker_punch: t1(66), protective_shadows: t1(67),
  mystical_meal: t2(68), inscribed_stealth: t2(69), wide_search: t2(70), silent_steps: t2(71), rogues_foresight: t2(72),
  enhanced_rings: t3(73), light_cloak: t3(74),
  enhanced_lethality: c3(75), assassins_reach: c3(76), bounty_hunter: c3(77),
  evasive_armor: c3(78), projectile_momentum: c3(79), speedy_stealth: c3(80),

  natures_bounty: t1(96), survivalists_intuition: t1(97), followup_strike: t1(98), natures_aid: t1(99),
  invigorating_meal: t2(100), liquid_nature: t2(101), rejuvenating_steps: t2(102), heightened_senses: t2(103), durable_projectiles: t2(104),
  point_blank: t3(105), seer_shot: t3(106),
  farsight: c3(107), shared_enchantment: c3(108), shared_upgrades: c3(109),
  durable_tips: c3(110), barkskin: c3(111), shielding_dew: c3(112),

  strengthening_meal: t1(128), adventurers_intuition: t1(129), patient_strike: t1(130), aggressive_barrier: t1(131),
  focused_meal: t2(132), liquid_agility: t2(133), weapon_recharging: t2(134), lethal_haste: t2(135), swift_equip: t2(136),
  precise_assault: t3(137), deadly_followup: t3(138),
  varied_charge: c3(139), twin_upgrades: c3(140), combined_lethality: c3(141),
  unencumbered_spirit: c3(142), monastic_vigor: c3(143), combined_energy: c3(144),

  satiated_spells: t1(160), holy_intuition: t1(161), searing_light: t1(162), shield_of_light: t1(163),
  enlightening_meal: t2(164), recall_inscription: t2(165), sunray: t2(166), divine_sense: t2(167), bless: t2(168),
  cleanse: t3(169), light_reading: t3(170),
  holy_lance: c3(171), hallowed_ground: c3(172), mnemonic_prayer: c3(173),
  lay_on_hands: c3(174), aura_of_protection: c3(175), wall_of_light: c3(176),

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
  closeTheGap: t4(145), invigoratingVictory: t4(146), eliminationMatch: t4(147),
  elementalReach: t4(148), strikingForce: t4(149), directedPower: t4(150),
  feignedRetreat: t4(151), exposeWeakness: t4(152), counterAbility: t4(153),
  divineIntervention: t4(177), judgement: t4(178), flash: t4(179),
  bodyForm: t4(180), mindForm: t4(181), spiritForm: t4(182),
  beamingRay: t4(183), lifeLink: t4(184), stasis: t4(185),
  heroicEnergy: t4(26),
};

/** Talent.icon: the heroic energy is drawn by the hero's class (its frame, 26 for the warrior, then 58, 90 and 122). */
export const HEROIC_ENERGY_ICON: Readonly<Partial<Record<HeroClass, number>>> = { warrior: 26, mage: 58, rogue: 90, huntress: 122, duelist: 154, cleric: 186 };
export const talentIcon = (talent: TalentId, heroClass: HeroClass): number =>
  talent === 'heroicEnergy' ? HEROIC_ENERGY_ICON[heroClass] ?? 26 : TALENTS[talent].icon;

/** ArmorAbility.talents(): the three of each ability, then the heroic energy. */
export const ABILITY_TALENTS: Readonly<Record<AbilityKind, readonly [TalentId, TalentId, TalentId, TalentId]>> = {
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
  challenge: ['closeTheGap', 'invigoratingVictory', 'eliminationMatch', 'heroicEnergy'],
  elementalStrike: ['elementalReach', 'strikingForce', 'directedPower', 'heroicEnergy'],
  feint: ['feignedRetreat', 'exposeWeakness', 'counterAbility', 'heroicEnergy'],
  ascendedForm: ['divineIntervention', 'judgement', 'flash', 'heroicEnergy'],
  trinity: ['bodyForm', 'mindForm', 'spiritForm', 'heroicEnergy'],
  powerOfMany: ['beamingRay', 'lifeLink', 'stasis', 'heroicEnergy'],
};

export const armorTalents = (ability: AbilityKind): TalentId[] => [...ABILITY_TALENTS[ability]];

/** Talent.tierLevelThresholds: tiers 1/2/3/4 start at levels 2/7/13/21 (index 5 is the end of the fourth). */
export const TIER_LEVELS: readonly number[] = [0, 2, 7, 13, 21, 31];
/** Hero.MAX_TALENT_TIERS. */
export const TALENT_TIERS = 4;

/** Talent.initClassTalents: each class's talents of tiers 1, 2 and 3. */
export const CLASS_TALENTS: Readonly<Record<HeroClass, readonly [readonly TalentId[], readonly TalentId[], readonly TalentId[]]>> = {
  warrior: [
    ['hearty_meal', 'veterans_intuition', 'provoked_anger', 'iron_will'],
    ['iron_stomach', 'liquid_willpower', 'runic_transference', 'lethal_momentum', 'improvised_projectiles'],
    ['hold_fast', 'strongman'],
  ],
  mage: [
    ['empowering_meal', 'scholars_intuition', 'lingering_magic', 'backup_barrier'],
    ['energizing_meal', 'inscribed_power', 'wand_preservation', 'arcane_vision', 'shield_battery'],
    ['desperate_power', 'ally_warp'],
  ],
  rogue: [
    ['cached_rations', 'thiefs_intuition', 'sucker_punch', 'protective_shadows'],
    ['mystical_meal', 'inscribed_stealth', 'wide_search', 'silent_steps', 'rogues_foresight'],
    ['enhanced_rings', 'light_cloak'],
  ],
  huntress: [
    ['natures_bounty', 'survivalists_intuition', 'followup_strike', 'natures_aid'],
    ['invigorating_meal', 'liquid_nature', 'rejuvenating_steps', 'heightened_senses', 'durable_projectiles'],
    ['point_blank', 'seer_shot'],
  ],
  duelist: [
    ['strengthening_meal', 'adventurers_intuition', 'patient_strike', 'aggressive_barrier'],
    ['focused_meal', 'liquid_agility', 'weapon_recharging', 'lethal_haste', 'swift_equip'],
    ['precise_assault', 'deadly_followup'],
  ],
  cleric: [
    ['satiated_spells', 'holy_intuition', 'searing_light', 'shield_of_light'],
    ['enlightening_meal', 'recall_inscription', 'sunray', 'divine_sense', 'bless'],
    ['cleanse', 'light_reading'],
  ],
};

/** Talent.initSubclassTalents: a subclass's talents of the third tier. */
export const SUBCLASS_TALENTS: Readonly<Record<SubClass, readonly TalentId[]>> = {
  berserker: ['endless_rage', 'deathless_fury', 'enraged_catalyst'],
  gladiator: ['cleave', 'lethal_defense', 'enhanced_combo'],
  battlemage: ['empowered_strike', 'mystical_charge', 'excess_charge'],
  warlock: ['soul_eater', 'soul_siphon', 'necromancers_minions'],
  assassin: ['enhanced_lethality', 'assassins_reach', 'bounty_hunter'],
  freerunner: ['evasive_armor', 'projectile_momentum', 'speedy_stealth'],
  sniper: ['farsight', 'shared_enchantment', 'shared_upgrades'],
  warden: ['durable_tips', 'barkskin', 'shielding_dew'],
  champion: ['varied_charge', 'twin_upgrades', 'combined_lethality'],
  monk: ['unencumbered_spirit', 'monastic_vigor', 'combined_energy'],
  priest: ['holy_lance', 'hallowed_ground', 'mnemonic_prayer'],
  paladin: ['lay_on_hands', 'aura_of_protection', 'wall_of_light'],
};

/** The class each talent is a class talent of (tier 1 to 3), for metamorphosis's pools. */
export const CLASS_OF_TALENT: Readonly<Partial<Record<TalentId, HeroClass>>> = (() => {
  const result: Partial<Record<TalentId, HeroClass>> = {};
  for (const [cls, tiers] of Object.entries(CLASS_TALENTS) as Array<[HeroClass, (typeof CLASS_TALENTS)[HeroClass]]>) {
    for (const tier of tiers) for (const id of tier) result[id] = cls;
  }
  return result;
})();

/** A hero's talents: four tiers of points by talent, in Shattered's order, and the talents metamorphosis replaced. */
export interface TalentBook {
  tiers: Array<Record<string, number>>;
  /** Hero.metamorphedTalents: the talent that was there -> the talent it became. */
  replaced?: Record<string, string>;
}

/** A hero's talents, started on first use (Talent.initClassTalents, initSubclassTalents). */
export function talentBook(hero: Hero): TalentBook {
  if (!hero.talents) {
    hero.talents = { tiers: [{}, {}, {}, {}] };
    initClassTalents(hero);
    if (hero.subclass) initSubclassTalents(hero);
  }
  // Talent.initArmorTalents: the armour ability's four, in the fourth tier.
  if (hero.ability) for (const id of ABILITY_TALENTS[hero.ability]) hero.talents.tiers[3]![id] ??= 0;
  return hero.talents;
}

/** Talent.initClassTalents: the class's talents of tiers 1 to 3, as metamorphosis left them. */
export function initClassTalents(hero: Hero): void {
  const book = hero.talents!;
  const tiers = CLASS_TALENTS[hero.heroClass];
  for (let i = 0; i < 3; i++) {
    for (const id of tiers[i]!) book.tiers[i]![book.replaced?.[id] ?? id] ??= 0;
  }
}

/** Talent.initSubclassTalents: the subclass's talents of the third tier. */
export function initSubclassTalents(hero: Hero): void {
  if (!hero.subclass) return;
  // A hero with no book yet gets the whole of it, the subclass's talents too.
  if (!hero.talents) {
    talentBook(hero);
    return;
  }
  const book = hero.talents;
  for (const id of SUBCLASS_TALENTS[hero.subclass]) book.tiers[2]![id] ??= 0;
}

/** The talents a hero can put points in at tier 4: the four of their armour ability (Talent.initArmorTalents). */
export function talentsOf(hero: Hero): TalentId[] {
  return hero.ability ? armorTalents(hero.ability) : [];
}

/** Hero.pointsInTalent. */
export function pointsInTalent(hero: Hero, id: TalentId): number {
  if (!hero.talents) return 0;
  for (const tier of hero.talents.tiers) {
    const points = tier[id];
    if (points !== undefined) return points;
  }
  return 0;
}

/** Hero.hasTalent. */
export const hasTalent = (hero: Hero, id: TalentId): boolean => pointsInTalent(hero, id) > 0;

/** The talents of a tier (1 to 4) a hero has, with their points, in order. */
export function talentsOfTier(hero: Hero, tier: number): Array<[TalentId, number]> {
  return Object.entries(talentBook(hero).tiers[tier - 1] ?? {}) as Array<[TalentId, number]>;
}

/** Hero.talentPointsSpent. */
export function talentPointsSpent(hero: Hero, tier: number): number {
  return Object.values(talentBook(hero).tiers[tier - 1] ?? {}).reduce((sum, points) => sum + points, 0);
}

/**
 * Hero.talentPointsAvailable: a point for every level from the tier's first (the level before it opens the tier,
 * but for the third tier a subclass is needed, and for the fourth an armour ability), the tier's share at most,
 * less the points spent, plus the points a potion of divine inspiration gave.
 */
export function talentPointsAvailable(hero: Hero, tier: number): number {
  const first = TIER_LEVELS[tier]!;
  const next = TIER_LEVELS[tier + 1]!;
  if (hero.lvl < first - 1 || (tier === 3 && !hero.subclass) || (tier === 4 && !hasArmorAbility(hero))) return 0;
  const spent = talentPointsSpent(hero, tier);
  const bonus = bonusTalentPoints(hero, tier);
  if (hero.lvl >= next) return next - first - spent + bonus;
  return 1 + hero.lvl - first - spent + bonus;
}

/** Hero.armorAbility != null: a hero with class armour has chosen an ability. */
export const hasArmorAbility = (hero: Hero): boolean => hero.ability !== undefined;

/** Hero.bonusTalentPoints: a potion of divine inspiration gave two points in a tier. */
export function bonusTalentPoints(hero: Hero, tier: number): number {
  const first = TIER_LEVELS[tier]!;
  if (hero.lvl < first - 1 || (tier === 3 && !hero.subclass) || (tier === 4 && !hasArmorAbility(hero))) return 0;
  return hero.buffs?.inspired?.includes(tier) ? 2 : 0;
}

/** How many points a tier gives in all (the badge on the hero button counts what is free). */
export const tierPoints = (tier: number): number => TIER_LEVELS[tier + 1]! - TIER_LEVELS[tier]!;

/** Every free talent point, over the tiers (the golden «+» on the hero button while it is over zero). */
export function talentPointsFree(hero: Hero): number {
  let total = 0;
  for (let tier = 1; tier <= TALENT_TIERS; tier++) total += Math.max(0, talentPointsAvailable(hero, tier));
  return total;
}

/** Why a point cannot be put in a talent, or null: it must be one the hero has, below its maximum, in a tier with a free point. */
export function upgradeProblem(hero: Hero, id: string): string | null {
  const book = talentBook(hero);
  for (let i = 0; i < book.tiers.length; i++) {
    const points = book.tiers[i]![id];
    if (points === undefined) continue;
    const def = TALENTS[id as TalentId];
    if (!def) return 'no such talent';
    if (points >= def.max) return 'that talent is at its best';
    return talentPointsAvailable(hero, i + 1) > 0 ? null : 'no free points in that tier';
  }
  return 'you have no such talent';
}

/** The tier (1 to 4) a talent sits in for this hero, or 0. */
export function tierOfTalent(hero: Hero, id: string): number {
  const book = talentBook(hero);
  for (let i = 0; i < book.tiers.length; i++) if (book.tiers[i]![id] !== undefined) return i + 1;
  return 0;
}
