import type { Char, Ctx } from '../floor';
import type { Hero } from '../actors';
import type { Item, ItemKind } from '../items';
import type { World } from '../world';
import { regenOn as heroRegenOn } from '../hero';

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

/** Seam (whoever ports Shattered's rings): RingOfEnergy.artifactChargeMultiplier; 1 without a ring of energy. */
export function artifactChargeMultiplier(_hero: Hero): number {
  return 1;
}

/** Seam (talents stream): the rogue's light cloak talent, points in it (the cloak works from the pack, slower). */
export function lightCloakPoints(_hero: Hero): number {
  return 0;
}

/** Regeneration.regenOn: false once a boss fight's LockedFloor stops regeneration and recharging (hero.ts). */
export function regenOn(ctx: Ctx, hero: Hero): boolean {
  return heroRegenOn(ctx.world, hero);
}

/** Seam (talents and abilities streams): the MagicImmune buff, under which no artifact works. */
export function magicImmune(_hero: Hero): boolean {
  return false;
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

/** Seam (alchemy stream): Dungeon.energy, the alchemical energy the run has (the toolkit's ENERGIZE spends it). */
export function alchemyEnergy(_world: World): number {
  return 0;
}

/** Seam (alchemy stream): spends alchemical energy. */
export function spendAlchemyEnergy(_world: World, _amount: number): void {
  // Nothing to spend until alchemy exists.
}

/**
 * Seam (alchemy stream): the toolkit's BREW — AlchemyScene with the toolkit's energy (AlchemistsToolkit
 * availableEnergy/consumeEnergy, exported from toolkit.ts). False until the alchemy window exists.
 */
export function canBrewAnywhere(): boolean {
  return false;
}

/** Seam (alchemy stream): ExoticScroll.regToExo — the exotic scroll a scroll kind is the counterpart of; null without exotics. */
export function exoticScrollOf(_kind: ItemKind): ItemKind | null {
  return null;
}

/**
 * Seam (alchemy stream): reads an exotic scroll for the unstable spellbook (anonymised, its talents off).
 * Returns false if it does not know the kind.
 */
export function readExoticScroll(_ctx: Ctx, _hero: Hero, _kind: ItemKind, _on: Item | undefined): boolean {
  return false;
}
