import type { Hero, HeroClass } from '../actors';
import type { Ctx } from '../floor';
import { Rng } from '../rng';
import { pointsInTalent, type AbilityKind } from '../talents';
import type { World } from '../world';
import { allyOf, canSummon, directAlly, summonHawk, summonShadow } from './allies';
import { beaconNeedsTarget, beaconCost, elementalBlast, elementalBlastProblem, warpBeacon, warpBeaconProblem, wildMagic, wildMagicProblem } from './mage';
import { endure, heroicLeap, leapCharge, leapProblem, shockwave, shockwaveProblem } from './warrior';
import { deathMark, deathMarkProblem, markCharge, smokeBomb, smokeBombProblem, smokeCharge } from './rogue';
import { naturesPower, spectralBlades, spectralBladesProblem } from './huntress';

/*
 * The armour abilities of the four classes (actors/hero/abilities, ArmorAbility): what each costs, what it asks for,
 * what it does. An ability is used through the class armour worn (classArmor.ts), spending its charge.
 */

export { ABILITY_TALENTS } from '../talents';
export type { AbilityKind } from '../talents';

export interface AbilityInfo {
  kind: AbilityKind;
  heroClass: HeroClass;
  /** ArmorAbility.baseChargeUse. */
  baseCharge: number;
  /** HeroIcon: the frame in hero_icons.png. */
  icon: number;
  /** The key of its messages (actors.hero.abilities.<class>.<key>). */
  key: string;
}

export const ABILITIES: Readonly<Record<AbilityKind, AbilityInfo>> = {
  heroicLeap: { kind: 'heroicLeap', heroClass: 'warrior', baseCharge: 35, icon: 16, key: 'warrior.heroicleap' },
  shockwave: { kind: 'shockwave', heroClass: 'warrior', baseCharge: 35, icon: 17, key: 'warrior.shockwave' },
  endure: { kind: 'endure', heroClass: 'warrior', baseCharge: 50, icon: 18, key: 'warrior.endure' },
  elementalBlast: { kind: 'elementalBlast', heroClass: 'mage', baseCharge: 35, icon: 19, key: 'mage.elementalblast' },
  wildMagic: { kind: 'wildMagic', heroClass: 'mage', baseCharge: 25, icon: 20, key: 'mage.wildmagic' },
  warpBeacon: { kind: 'warpBeacon', heroClass: 'mage', baseCharge: 35, icon: 21, key: 'mage.warpbeacon' },
  smokeBomb: { kind: 'smokeBomb', heroClass: 'rogue', baseCharge: 50, icon: 22, key: 'rogue.smokebomb' },
  deathMark: { kind: 'deathMark', heroClass: 'rogue', baseCharge: 25, icon: 23, key: 'rogue.deathmark' },
  shadowClone: { kind: 'shadowClone', heroClass: 'rogue', baseCharge: 35, icon: 24, key: 'rogue.shadowclone' },
  spectralBlades: { kind: 'spectralBlades', heroClass: 'huntress', baseCharge: 25, icon: 25, key: 'huntress.spectralblades' },
  naturesPower: { kind: 'naturesPower', heroClass: 'huntress', baseCharge: 35, icon: 26, key: 'huntress.naturespower' },
  spiritHawk: { kind: 'spiritHawk', heroClass: 'huntress', baseCharge: 35, icon: 27, key: 'huntress.spirithawk' },
};

/** HeroClass.armorAbilities: the three each class may choose from. */
export const CLASS_ABILITIES: Readonly<Record<HeroClass, readonly AbilityKind[]>> = {
  warrior: ['heroicLeap', 'shockwave', 'endure'],
  mage: ['elementalBlast', 'wildMagic', 'warpBeacon'],
  rogue: ['smokeBomb', 'deathMark', 'shadowClone'],
  huntress: ['spectralBlades', 'naturesPower', 'spiritHawk'],
};

/** What the player has to give when using an ability: a cell to aim at, one of the beacon's two choices, or nothing. */
export type Aim = 'none' | 'cell' | 'beacon';

/** The class armour worn (the item), if the hero wears their own. */
export const wornClassArmor = (hero: Hero) => (hero.armor.kind === `armor.${hero.heroClass}` ? hero.armor : undefined);

/** ArmorAbility.chargeUse: the base cost, less with Heroic Energy (12%, 23%, 32%, 40% off), and each ability's own changes. */
export function chargeUse(world: World | undefined, hero: Hero, ability: AbilityKind | undefined = hero.ability): number {
  if (!ability) return 0;
  let use = ABILITIES[ability].baseCharge;
  switch (pointsInTalent(hero, 'heroicEnergy')) {
    case 1: use *= 0.88; break;
    case 2: use *= 0.77; break;
    case 3: use *= 0.68; break;
    case 4: use *= 0.6; break;
    default:
  }
  switch (ability) {
    case 'heroicLeap': return leapCharge(hero, use);
    case 'smokeBomb': return smokeCharge(hero, use);
    case 'deathMark': return markCharge(hero, use);
    case 'shadowClone': return hasAlly(world, hero, 'shadow') ? 0 : use;
    case 'spiritHawk': return hasAlly(world, hero, 'hawk') ? 0 : use;
    default: return use;
  }
}

const hasAlly = (world: World | undefined, hero: Hero, kind: 'shadow' | 'hawk'): boolean =>
  (world?.floors[hero.depth]?.mobs ?? []).some((mob) => mob.kind === kind && mob.hp > 0 && mob.directed?.owner === hero.id);

/** ArmorAbility.targetingPrompt: what the ability asks for now. */
export function abilityAim(world: World, hero: Hero): Aim {
  switch (hero.ability) {
    case 'heroicLeap': case 'shockwave': case 'wildMagic': case 'smokeBomb': case 'deathMark': case 'spectralBlades':
      return 'cell';
    case 'warpBeacon':
      return hero.abil?.beacon ? 'beacon' : beaconNeedsTarget(hero) ? 'cell' : 'none';
    case 'shadowClone':
      return hasAlly(world, hero, 'shadow') ? 'cell' : 'none';
    case 'spiritHawk':
      return hasAlly(world, hero, 'hawk') ? 'cell' : 'none';
    default:
      return 'none';
  }
}

export interface AbilityUse {
  target?: number;
  choice?: number;
}

/** A throwaway context for deciding whether an ability can be used (nothing it does is kept). */
function probe(world: World, hero: Hero): Ctx {
  const floor = world.floors[hero.depth]!;
  return { world, depth: hero.depth, level: world.levels[hero.depth]!, floor, rng: new Rng({ ...floor.rng }), effects: [] };
}

/**
 * Why the ability cannot be used now (ClassArmor.execute and each activate): no class armour worn, no ability chosen,
 * not enough charge, or what the ability itself needs and has not got.
 */
export function abilityProblem(world: World, hero: Hero, use: AbilityUse): string | null {
  const armor = wornClassArmor(hero);
  if (!armor) return 'art:items.armor.classarmor.not_equipped';
  if (!hero.ability) return 'art:items.armor.classarmor.no_ability';
  if ((armor.charge ?? 0) < chargeUse(world, hero)) return 'art:items.armor.classarmor.low_charge';
  const ctx = probe(world, hero);
  const { target, choice } = use;
  switch (hero.ability) {
    case 'heroicLeap': return leapProblem(hero, target);
    case 'shockwave': return shockwaveProblem(hero, target);
    case 'endure': return null;
    case 'elementalBlast': return elementalBlastProblem(hero);
    case 'wildMagic': return wildMagicProblem(hero, target);
    case 'warpBeacon': return warpBeaconProblem(ctx, hero, target, choice, armor.charge ?? 0, chargeUse(world, hero));
    case 'smokeBomb': return smokeBombProblem(ctx, hero, target);
    case 'deathMark': return deathMarkProblem(ctx, hero, target);
    case 'shadowClone':
      if (hasAlly(world, hero, 'shadow')) return target !== undefined && Number.isInteger(target) ? null : 'art:actors.hero.abilities.armorability.prompt';
      return canSummon(ctx, hero, 'shadow') ? null : 'art:actors.hero.abilities.huntress.spirithawk.no_space';
    case 'spectralBlades': return spectralBladesProblem(ctx, hero, target);
    case 'naturesPower': return null;
    case 'spiritHawk':
      if (hasAlly(world, hero, 'hawk')) return target !== undefined && Number.isInteger(target) ? null : 'art:actors.hero.abilities.armorability.prompt';
      return canSummon(ctx, hero, 'hawk') ? null : 'art:actors.hero.abilities.huntress.spirithawk.no_space';
  }
}

/** What the world gives an ability to reach beyond the level: the warp beacon's return to another depth. */
export interface AbilityDeps {
  returnTo(depth: number, pos: number): void;
}

/** ClassArmor.execute: the ability is used, its charge spent; returns the time it took. */
export function useAbility(ctx: Ctx, hero: Hero, use: AbilityUse, deps: AbilityDeps): number {
  const armor = wornClassArmor(hero)!;
  const cost = chargeUse(ctx.world, hero);
  const { target, choice } = use;
  const spend = (charge = cost): void => {
    armor.charge = Math.max(0, (armor.charge ?? 0) - charge);
  };
  switch (hero.ability!) {
    case 'heroicLeap': spend(); return heroicLeap(ctx, hero, target!);
    case 'shockwave': spend(); return shockwave(ctx, hero, target!);
    case 'endure': spend(); return endure(ctx, hero);
    case 'elementalBlast': spend(); return elementalBlast(ctx, hero);
    case 'wildMagic': spend(); return wildMagic(ctx, hero, target!);
    case 'warpBeacon': {
      const done = warpBeacon(ctx, hero, target, choice, cost, deps);
      spend(done.charge);
      return done.time;
    }
    case 'smokeBomb': spend(); return smokeBomb(ctx, hero, target!);
    case 'deathMark': spend(); return deathMark(ctx, hero, target!);
    case 'shadowClone': {
      const clone = allyOf(ctx, 'shadow');
      if (clone) {
        directAlly(ctx, hero, clone, target!);
        return 0;
      }
      spend();
      summonShadow(ctx, hero);
      return 1;
    }
    case 'spectralBlades': spend(); return spectralBlades(ctx, hero, target!);
    case 'naturesPower': spend(); return naturesPower(ctx, hero);
    case 'spiritHawk': {
      const hawk = allyOf(ctx, 'hawk');
      if (hawk) {
        directAlly(ctx, hero, hawk, target!);
        return 0;
      }
      spend();
      summonHawk(ctx, hero);
      return 1;
    }
  }
}

export { beaconCost };
export { alliesFollow, allyArmor, allyOwner, cloneGlyph, copyReach, hawkDodges, hawkProc, hawkSight, swapWithClone } from './allies';
export { directableAct } from './allies';
export { deathMarkTurn, endDeathMark, fearTheReaper } from './rogue';
export { endEnduring, endureAdjust, endureStrike } from './warrior';
export { abilityProcBonus, bladeBowProc, natureActive, natureArrowProc, natureBowSpeed, natureSpeed } from './huntress';
export { staffWand, wildMagicLevel } from './mage';
export type { AbilityState } from './state';
