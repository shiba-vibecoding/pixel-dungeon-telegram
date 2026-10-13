import { isAlive } from './actors';
import { type Char, charAt, type Ctx, isHero, isWater } from './floor';
import { freezeHeaps } from './cooking';
import { chill, CHILL_TURNS, freeze, FROST_TURNS, ignite as igniteChar, ooze, OOZE_TURNS } from './status';
import { championImmune } from './champions';
import { hasProp, isImmune, resistance } from './props';
import { immuneTo } from './traps';
import type { Rng } from './rng';

/*
 * What Shattered's monsters do to whom they strike (actors/buffs, as the
 * monsters use them): Bleeding, Burning, Freezing's chill, Ooze, Weakness,
 * Vulnerable, Hex, Degrade, Cripple, Blindness, Poison, Charm, Roots,
 * Adrenaline. Kept as turns left on the creature; Chill, Frost, Ooze and the
 * curses wear off as status.ts has them, the rest in world.ts spend (a hero)
 * and traps.ts mobConditions (a monster).
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
  if (immuneTo(char, 'burning') || championImmune(char, 'burning') || isImmune(char, 'burning')) return;
  igniteChar(char);
  char.burning = Math.max(char.burning ?? 0, turns);
}

/**
 * Freezing.freeze on a cell: whoever is there is chilled (longer in water), up to Chill.DURATION, and once full of
 * chill frozen solid; the frozen stay frozen a little longer; what lies there freezes.
 */
export function freezeCell(ctx: Ctx, cell: number): void {
  const ch = charAt(ctx.world, ctx.depth, cell);
  if (ch && isAlive(ch) && !isImmune(ch, 'frost')) {
    if ((ch.frozen ?? 0) > 0) {
      ch.frozen = ch.frozen! + 2;
    } else {
      const before = ch.chill ?? 0;
      let add = isWater(ctx.level.map[cell]!) ? 5 : 3;
      if (before > 0) add = Math.min(add, (CHILL_TURNS - before) / Math.max(resistance(ch, 'chill'), 0.01));
      if (add > 0) chill(ch, add);
      if (before > 0 && (ch.chill ?? 0) >= CHILL_TURNS) freeze(ctx, ch, FROST_TURNS);
    }
  }
  freezeHeaps(ctx, cell, 0);
}

/** Ooze.set(Ooze.DURATION): caustic ooze that eats away until washed off in water (status.ts; not on the acidic). */
export function oozeOn(ctx: Ctx, char: Char): void {
  if (hasProp(char, 'acidic')) return;
  if (isHero(char) && char.ooze < 0) ctx.effects.push({ type: 'oozed', hero: char.id });
  ooze(char, OOZE_TURNS);
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

