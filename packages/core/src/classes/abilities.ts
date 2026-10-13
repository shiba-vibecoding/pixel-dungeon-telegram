import type { Hero } from '../actors';
import { regenOn } from '../hero';
import { armorChargeMultiplier } from '../rings';
import { heroView, type Ctx, type Char } from '../floor';
import type { World } from '../world';
import { CLASS_ARMOR_OF } from '../classArmor';
import { type AbilityId, ARMOR_ABILITIES, hasTalent, pointsIn } from '../talents';
import { challengeProblem, doChallenge, doElementalStrike, doFeint, duelTurn, elementalProblem, eliminationActive, feintProblem } from './duelist-armor';
import { ascendedProblem, doAscend, doPowerOfMany, doTrinity, powerProblem, trinityCost, trinityProblem } from './cleric-armor';

/*
 * The class armour's charge (ClassArmor.Charger: 0 to 100, 50 to begin with, a fifth of a point a turn) and the armour
 * abilities of the Duelist and the Cleric (ArmorAbility): each costs a share of the charge, less with heroic energy.
 * SEAM(abilities): the abilities stream owns ClassArmor and the other four classes' abilities; the Duelist's and
 * the Cleric's are registered here.
 */

export interface AbilityDef {
  id: AbilityId;
  /** ArmorAbility.baseChargeUse. */
  cost: number;
  /** Whether the ability asks for a cell (targetingPrompt). */
  aims: boolean;
  problem(world: World, hero: Hero, cell: number | undefined): string | null;
  perform(ctx: Ctx, hero: Hero, cell: number | undefined): number;
}

export const ABILITY_DEFS: Readonly<Record<AbilityId, AbilityDef>> = {
  challenge: { id: 'challenge', cost: 50, aims: true, problem: challengeProblem, perform: doChallenge },
  elementalStrike: { id: 'elementalStrike', cost: 25, aims: true, problem: elementalProblem, perform: doElementalStrike },
  feint: { id: 'feint', cost: 35, aims: true, problem: feintProblem, perform: doFeint },
  ascendedForm: { id: 'ascendedForm', cost: 35, aims: false, problem: ascendedProblem, perform: doAscend },
  trinity: { id: 'trinity', cost: 0, aims: false, problem: trinityProblem, perform: doTrinity },
  powerOfMany: { id: 'powerOfMany', cost: 35, aims: false, problem: powerProblem, perform: doPowerOfMany },
};

export const abilityDef = (hero: Hero): AbilityDef | undefined => (hero.armorAbility ? ABILITY_DEFS[hero.armorAbility as AbilityId] : undefined);

/** The abilities a class may choose among (HeroClass.armorAbilities), when the classes stream has them. */
export const abilitiesOf = (hero: Hero): readonly AbilityId[] => ARMOR_ABILITIES[hero.heroClass] ?? [];

/** ClassArmor.charge: percent, from 0 to 100; absent in older saves until first used (50). */
export const armorCharge = (hero: Hero): number => (hero.armor.charge ??= 50);

/** ArmorAbility.chargeUse: less with heroic energy (12%/23%/32%/40%), and the elimination match's cheaper challenge (16%...50%). */
export function chargeUse(hero: Hero, def: AbilityDef): number {
  let use = def.cost;
  if (def.id === 'trinity') use = trinityCost(hero);
  switch (pointsIn(hero, 'HEROIC_ENERGY')) {
    case 1: use *= Math.fround(0.88); break;
    case 2: use *= Math.fround(0.77); break;
    case 3: use *= Math.fround(0.68); break;
    case 4: use *= Math.fround(0.6); break;
  }
  if (def.id === 'challenge' && eliminationActive(hero)) use *= 0.84 ** pointsIn(hero, 'ELIMINATION_MATCH');
  return Math.fround(use);
}

/** Pays for an ability out of the armour's charge. */
export function spendArmorCharge(hero: Hero, amount: number): void {
  hero.armor.charge = armorCharge(hero) - amount;
}

/** ClassArmor.Charger.act: 500 turns to full, faster with rings of energy; not while a sealed floor stops healing. */
export function classArmorTurn(ctx: Ctx, hero: Hero): void {
  duelTurn(ctx, hero);
  if (!hero.armorAbility || !abilityDef(hero) || hero.armor.charge === undefined || hero.armor.kind !== CLASS_ARMOR_OF[hero.heroClass]) return;
  if (regenOn(ctx.world, hero)) hero.armor.charge = Math.min(100, hero.armor.charge + Math.fround(Math.fround(100 / 500) * armorChargeMultiplier(hero)));
}

/** Why the class armour's ability cannot be used now (ClassArmor.execute, then the ability's own refusals), or null. */
export function abilityProblem(world: World, hero: Hero, cell: number | undefined): string | null {
  const def = abilityDef(hero);
  if (!def) return 'art:items.armor.classarmor.no_ability';
  if (armorCharge(hero) < chargeUse(hero, def)) return 'art:items.armor.classarmor.low_charge';
  if (def.aims && (cell === undefined || !Number.isInteger(cell) || cell < 0)) return 'choose a target';
  return def.problem(world, hero, cell);
}

/** Uses the ability; returns the time it took. */
export function performAbility(ctx: Ctx, hero: Hero, cell: number | undefined): number {
  const def = abilityDef(hero)!;
  return def.perform(ctx, hero, cell);
}

/** Whether a creature in sight is somebody the hero fights (Char.Alignment.ENEMY). */
export function seen(ctx: Ctx, hero: Hero, char: Char): boolean {
  return heroView(ctx.world, hero)[char.pos] === true;
}

export { hasTalent };
