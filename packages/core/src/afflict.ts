import { type Char, type Ctx, isHero } from './floor';
import { championImmune } from './champions';
import { hasProp } from './props';
import { burst, immuneTo } from './traps';
import type { Rng } from './rng';

/*
 * What Shattered's monsters do to whom they strike (actors/buffs, as the
 * monsters use them): Bleeding, Burning, Freezing's chill, Ooze, Weakness,
 * Vulnerable, Hex, Degrade, Cripple, Blindness, Poison, Charm, Roots,
 * Adrenaline. Kept as turns left on the creature; heroes count theirs down
 * in world.ts spend, monsters in traps.ts mobConditions.
 * SEAM(wands): Chill, Frost and Ooze on a monster are the wands stream's
 * (status.ts); until they are in, the nearest Pixel Dungeon has stands in.
 */

/** Weakness.DURATION, Vulnerable.DURATION, Hex.DURATION, Degrade.DURATION, Cripple.DURATION, Blindness.DURATION, Charm.DURATION, Roots.DURATION. */
export const WEAKNESS_TURNS = 20;
export const VULNERABLE_TURNS = 20;
export const HEX_TURNS = 30;
export const DEGRADE_TURNS = 30;
export const CRIPPLE_TURNS = 10;
export const BLINDNESS_TURNS = 10;
export const CHARM_TURNS = 10;
export const ROOTS_TURNS = 5;
/** Burning.DURATION. */
export const BURNING_TURNS = 8;
/** Adrenaline from a necromancer's zap. */
export const ADRENALINE_TURNS = 3;

/** Bleeding.set: a roll between half the level and the level, kept if it is more than what bleeds already. */
export function bleed(rng: Rng, char: Char, level: number): void {
  if (hasProp(char, 'inorganic')) return;
  const rolled = rng.normalFloat(level / 2, level);
  if ((char.bleeding ?? 0) < rolled) char.bleeding = rolled;
}

/**
 * Bleeding.act: what bleeds hurts as much as it bleeds (rounded), then eases to between half and all of it;
 * once it rounds to nothing, it has stopped. Returns the harm to do this turn.
 */
export function bleedTick(rng: Rng, char: Char): number {
  const level = char.bleeding ?? 0;
  const damage = Math.round(level);
  char.bleeding = rng.normalFloat(level / 2, level);
  if (Math.round(char.bleeding) <= 0) char.bleeding = 0;
  return damage;
}

/** Burning.reignite: alight for the whole of the time (Burning.DURATION) again, unless it cannot burn (water puts it out). */
export function ignite(char: Char, turns = BURNING_TURNS): void {
  if (immuneTo(char, 'burning') || championImmune(char, 'burning') || hasProp(char, 'fiery')) return;
  char.burning = Math.max(char.burning ?? 0, turns);
}

/**
 * Freezing.freeze on a cell: a chill there, longer in water, until the chill is full and freezes it solid.
 * SEAM(wands): Chill and Frost (status.ts); until then a frost burst on that one cell stands in.
 */
export function freezeCell(ctx: Ctx, cell: number): void {
  burst(ctx, cell, 'frost', 0, true);
}

/** Ooze.set(Ooze.DURATION): caustic ooze that eats away until washed off in water. SEAM(wands): Ooze on a monster. */
export function oozeOn(ctx: Ctx, char: Char): void {
  if (hasProp(char, 'acidic')) return;
  if (isHero(char)) {
    if (char.ooze < 0) ctx.effects.push({ type: 'oozed', hero: char.id });
    char.ooze = 0;
  }
}

/** Buff.prolong(Weakness / Vulnerable / Hex / Cripple / Blindness, DURATION): at least that long. */
export function weaken(char: Char, turns = WEAKNESS_TURNS): void {
  char.weakened = Math.max(char.weakened ?? 0, turns);
}
export function makeVulnerable(char: Char, turns = VULNERABLE_TURNS): void {
  char.vulnerable = Math.max(char.vulnerable ?? 0, turns);
}
export function hex(char: Char, turns = HEX_TURNS): void {
  char.hexed = Math.max(char.hexed ?? 0, turns);
}
export function cripple(char: Char, turns = CRIPPLE_TURNS): void {
  char.crippled = Math.max(char.crippled ?? 0, turns);
}
export function blind(char: Char, turns = BLINDNESS_TURNS): void {
  char.blind = Math.max(char.blind ?? 0, turns);
}
/** Roots (a web, or Earthroot): it cannot move. */
export function root(char: Char, turns = ROOTS_TURNS): void {
  if (isHero(char)) char.rooted = Math.max(char.rooted, turns);
  else char.rooted = Math.max(char.rooted ?? 0, turns);
}
/** Poison.set: at least that long. */
export function poison(char: Char, turns: number): void {
  if (hasProp(char, 'inorganic')) return;
  char.poison = Math.max(char.poison ?? 0, turns);
}
/** Degrade (a warlock's bolt) on a hero: their upgraded gear works as less upgraded for a while. */
export function degrade(char: Char, turns = DEGRADE_TURNS): void {
  if (isHero(char)) char.degraded = Math.max(char.degraded ?? 0, turns);
}

/**
 * Degrade.reduceLevel: what an upgraded item's level comes to while degraded (+1 stays +1, +3 is +3, +5 is +4,
 * +10 is +5). SEAM(gear): Item.buffedLvl applies it to what the hero wears and wields.
 */
export const degradedLevel = (level: number): number => (level <= 0 ? level : Math.round(Math.sqrt(2 * (level - 1)) + 1));

/** Hex: a fifth worse; Bless: a quarter better (a hero's, Hero.blessed); champions as their kind (Char.hit). */
export function rollFactor(char: Char): number {
  let factor = 1;
  if ((char.hexed ?? 0) > 0) factor *= 0.8;
  return factor;
}
