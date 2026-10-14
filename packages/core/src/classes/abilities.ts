import { ipow } from '../fmath';
import type { Hero } from '../actors';
import { heroView, type Ctx, type Char } from '../floor';
import type { World } from '../world';
import { hasTalent, pointsInTalent as pointsIn } from '../talents/data';
import { challengeProblem, doChallenge, doElementalStrike, doFeint, duelTurn, elementalProblem, eliminationActive, feintProblem } from './duelist-armor';
import { ascendedProblem, doAscend, doPowerOfMany, doTrinity, powerCost, powerProblem, trinityCost, trinityProblem } from './cleric-armor';

/*
 * The class armour's charge (ClassArmor.Charger: 0 to 100, 50 to begin with, a fifth of a point a turn) and the armour
 * abilities of the Duelist and the Cleric (ArmorAbility): each costs a share of the charge, less with heroic energy.
 * SEAM(abilities): the abilities stream owns ClassArmor and the other four classes' abilities; the Duelist's and
 * the Cleric's are registered here.
 */

/** The Duelist's and the Cleric's armour abilities (abilities/index.ts holds them beside the other four classes'). */
export type ClassAbilityId = 'challenge' | 'elementalStrike' | 'feint' | 'ascendedForm' | 'trinity' | 'powerOfMany';

export interface AbilityDef {
  id: ClassAbilityId;
  /** ArmorAbility.baseChargeUse. */
  cost: number;
  /** Whether the ability asks for a cell (targetingPrompt). */
  aims: boolean;
  /** What it costs when the ability's cost varies (Trinity's, by the effect used). */
  costOf?(hero: Hero, choice: number | undefined, world?: World): number;
  problem(world: World, hero: Hero, cell: number | undefined, choice: number | undefined): string | null;
  perform(ctx: Ctx, hero: Hero, cell: number | undefined, choice: number | undefined): number;
}

export const ABILITY_DEFS: Readonly<Record<ClassAbilityId, AbilityDef>> = {
  challenge: { id: 'challenge', cost: 50, aims: true, problem: challengeProblem, perform: doChallenge },
  elementalStrike: { id: 'elementalStrike', cost: 25, aims: true, problem: elementalProblem, perform: doElementalStrike },
  feint: { id: 'feint', cost: 35, aims: true, problem: feintProblem, perform: doFeint },
  ascendedForm: { id: 'ascendedForm', cost: 50, aims: false, problem: (w, h, c) => ascendedProblem(w, h, c), perform: (ctx, h, c) => doAscend(ctx, h, c) },
  trinity: {
    id: 'trinity', cost: 25, aims: false, costOf: (hero, choice) => trinityCost(hero, choice),
    problem: (w, h, c, choice) => trinityProblem(w, h, c, choice), perform: (ctx, h, c, choice) => doTrinity(ctx, h, c, choice),
  },
  powerOfMany: {
    id: 'powerOfMany', cost: 35, aims: true, costOf: (hero, _choice, world) => powerCost(world, hero),
    problem: (w, h, c) => powerProblem(w, h, c), perform: (ctx, h, c) => doPowerOfMany(ctx, h, c),
  },
};

export const isClassAbility = (id: string | undefined): id is ClassAbilityId => id !== undefined && Object.hasOwn(ABILITY_DEFS, id);

export const abilityDef = (hero: Hero): AbilityDef | undefined => (isClassAbility(hero.ability) ? ABILITY_DEFS[hero.ability] : undefined);

/** ClassArmor.charge: percent, from 0 to 100. */
export const armorCharge = (hero: Hero): number => hero.armor.charge ?? 0;

/** ArmorAbility.chargeUse: less with heroic energy (12%/23%/32%/40%), and the elimination match's cheaper challenge (16%...50%). */
export function chargeUse(hero: Hero, def: AbilityDef, choice?: number, world?: World): number {
  let use = def.costOf ? def.costOf(hero, choice, world) : def.cost;
  switch (pointsIn(hero, 'heroicEnergy')) {
    case 1: use *= Math.fround(0.88); break;
    case 2: use *= Math.fround(0.77); break;
    case 3: use *= Math.fround(0.68); break;
    case 4: use *= Math.fround(0.6); break;
  }
  if (def.id === 'challenge' && eliminationActive(hero)) use *= ipow(0.84, pointsIn(hero, 'eliminationMatch'));
  return Math.fround(use);
}

/** Pays for an ability out of the armour's charge. */
export function spendArmorCharge(hero: Hero, amount: number): void {
  hero.armor.charge = armorCharge(hero) - amount;
}

/** What the class armour's abilities do each turn (the charge itself is classArmor.ts chargeClassArmor). */
export function classArmorTurn(ctx: Ctx, hero: Hero): void {
  duelTurn(ctx, hero);
}

/** Why the class armour's ability cannot be used now (ClassArmor.execute, then the ability's own refusals), or null. */
export function classAbilityProblem(world: World, hero: Hero, cell: number | undefined, choice?: number): string | null {
  const def = abilityDef(hero);
  if (!def) return 'art:items.armor.classarmor.no_ability';
  if (def.aims && (cell === undefined || !Number.isInteger(cell) || cell < 0)) return 'choose a target';
  const own = def.problem(world, hero, cell, choice);
  if (own) return own;
  if (armorCharge(hero) < chargeUse(hero, def, choice, world)) return 'art:items.armor.classarmor.low_charge';
  return null;
}

/** Uses the ability; returns the time it took. */
export function performClassAbility(ctx: Ctx, hero: Hero, cell: number | undefined, choice?: number): number {
  const def = abilityDef(hero)!;
  return def.perform(ctx, hero, cell, choice);
}

/** Whether a creature in sight is somebody the hero fights (Char.Alignment.ENEMY). */
export function seen(ctx: Ctx, hero: Hero, char: Char): boolean {
  return heroView(ctx.world, hero)[char.pos] === true;
}

export { hasTalent };
