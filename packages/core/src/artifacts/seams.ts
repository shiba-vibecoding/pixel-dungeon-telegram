import type { Char, Ctx } from '../floor';
import type { Hero } from '../actors';
import { EXOTIC_OF, type Item, itemDef, type ItemKind } from '../items';
import { isMagicImmune } from '../buffs';
import { readScroll } from '../reading';
import type { World } from '../world';
import { regenOn as heroRegenOn } from '../hero';
import { energyArtifactMultiplier } from '../rings';

/*
 * Seams: where artifacts meet systems other streams of the Shattered port are
 * bringing in at the same time (talents, rings, alchemy, bosses, classes).
 * Each says what Shattered does there; until its stream fills it in, it does
 * what a hero without that system would see.
 */

/** Seam (talents stream): Talent.onArtifactUsed — the talents that answer an artifact's use (e.g. enhanced rings). */
export function onArtifactUsed(_ctx: Ctx, _hero: Hero): void {
  // Nothing until talents exist.
}

/**
 * Seam (talents and classes streams): Artifact.artifactProc — on a creature an artifact acted on, the priest's
 * guiding light, the searing light and sunray talents. `visibleLevel` is the artifact's shown level, `charges`
 * the charge it used.
 */
export function artifactProc(_ctx: Ctx, _target: Char, _visibleLevel: number, _charges: number): void {
  // Nothing until talents exist.
}

/** RingOfEnergy.artifactChargeMultiplier (rings.ts; the talents' light cloak aside). */
export function artifactChargeMultiplier(hero: Hero): number {
  return energyArtifactMultiplier(hero);
}

/** Seam (talents stream): the rogue's light cloak talent, points in it (the cloak works from the pack, slower). */
export function lightCloakPoints(_hero: Hero): number {
  return 0;
}

/** Regeneration.regenOn: false once a boss fight's LockedFloor stops regeneration and recharging (hero.ts). */
export function regenOn(ctx: Ctx, hero: Hero): boolean {
  return heroRegenOn(ctx.world, hero);
}

/** The MagicImmune buff (alchemy's potion of magic immunity; the talents and abilities streams' too): no artifact works. */
export function magicImmune(hero: Hero): boolean {
  return isMagicImmune(hero);
}

/** Seam (talents stream): Food.eatingTime — the meal talents eat two turns faster than Food.TIME_TO_EAT. */
export function eatingTime(_hero: Hero): number {
  return 3;
}

/** Seam (talents stream): Talent.onFoodEaten, after the horn of plenty fed the hero `energy`. */
export function onFoodEaten(_ctx: Ctx, _hero: Hero, _energy: number, _item: Item): void {
  // Nothing until talents exist.
}

/** Seam (talents stream): CloakOfShadows.cloakStealth.attachTo — the assassin's Preparation and protective shadows. */
export function onCloakStealth(_ctx: Ctx, _hero: Hero): void {
  // Nothing until talents exist.
}

/** Dungeon.energy, the alchemical energy the run has (the toolkit's ENERGIZE spends it; alchemy.ts). */
export function alchemyEnergy(world: World): number {
  return world.energy ?? 0;
}

/** Spends alchemical energy. */
export function spendAlchemyEnergy(world: World, amount: number): void {
  world.energy = Math.max(0, (world.energy ?? 0) - amount);
}

/**
 * Seam (alchemy stream): the toolkit's BREW — AlchemyScene with the toolkit's energy (AlchemistsToolkit
 * availableEnergy/consumeEnergy, exported from toolkit.ts). False until the alchemy window exists.
 */
export function canBrewAnywhere(): boolean {
  return true;
}

/** ExoticScroll.regToExo — the exotic scroll a scroll kind is the counterpart of (items.ts EXOTIC_OF). */
export function exoticScrollOf(kind: ItemKind): ItemKind | null {
  return EXOTIC_OF[kind] ?? null;
}

/**
 * Seam (alchemy stream): reads an exotic scroll for the unstable spellbook (anonymised, its talents off).
 * Returns false if it does not know the kind.
 */
export function readExoticScroll(ctx: Ctx, hero: Hero, kind: ItemKind, on: Item | undefined): boolean {
  if (itemDef(kind).category !== 'scroll') return false;
  readScroll(ctx, hero, kind, on);
  return true;
}
