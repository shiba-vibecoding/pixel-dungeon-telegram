import type { Hero, SubClass } from '../actors';
import type { HeroClass } from '../heroclass';

/*
 * Shattered Pixel Dungeon's talents (actors/hero/Talent.java) for the four classes: tiers 1 to 3 of each class and
 * the subclasses' third tier. The fourth tier belongs to the armour abilities (the abilities stream) and stays empty
 * here. A talent is named as in the original's message keys (hearty_meal), its icon is its frame in talent_icons.png.
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
  | 'durable_tips' | 'barkskin' | 'shielding_dew';

export interface TalentDef {
  /** Talent.icon: the frame in talent_icons.png (32 to a row). */
  icon: number;
  /** Talent.maxPoints. */
  max: number;
  /** The tier it belongs to, 1 to 3. */
  tier: 1 | 2 | 3;
}

/** Talent(int icon): two points at most; the third tier's are Talent(icon, 3). */
const t1 = (icon: number): TalentDef => ({ icon, max: 2, tier: 1 });
const t2 = (icon: number): TalentDef => ({ icon, max: 2, tier: 2 });
const t3 = (icon: number): TalentDef => ({ icon, max: 3, tier: 3 });
const c3 = t3;

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
};

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

/**
 * Hero.armorAbility != null: a hero with class armour has chosen an ability. SEAM(abilities): the abilities stream, which
 * brings the armour abilities and the fourth tier's talents, answers here.
 */
export const hasArmorAbility = (_hero: Hero): boolean => false;

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
