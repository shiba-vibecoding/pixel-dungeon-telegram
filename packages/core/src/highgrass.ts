import { createItem } from './items';
import { ItemGenerator } from './items';
import { type Char, type Ctx, dropItem, isHero } from './floor';
import { Feeling } from './level/gen/dungeon';
import { T } from './level/terrain';
import { isChallenged, NO_HERBALISM } from './challenges';

/*
 * levels/features/HighGrass: tall grass flattened by whoever goes through it, now and then shedding a
 * seed or a dewdrop. The huntress only furrows it (FURROWED_GRASS still stands and hides, sheds
 * nothing more, and anyone else flattens it).
 */

/** Tall grass, or the huntress's furrows: what a step tramples. */
export const isTallGrass = (terrain: number | undefined): boolean => terrain === T.HIGH_GRASS || terrain === T.FURROWED_GRASS;

/** HighGrass.trample(level, pos), with whoever stands there (null: something else pressed the cell). */
export function trample(ctx: Ctx, pos: number, ch: Char | null): void {
  const { level, rng } = ctx;
  const huntress = ch !== null && isHero(ch) && ch.heroClass === 'huntress';
  if (level.map[pos] === T.FURROWED_GRASS) {
    // Furrowed already: the huntress leaves it so, anyone else flattens it; it sheds nothing.
    if (!huntress) level.map[pos] = T.GRASS;
    return;
  }
  if (level.map[pos] !== T.HIGH_GRASS) return;
  // SEAM(talents): Talent.BARKSKIN for the huntress; Pixel Dungeon's warden draws bark from the grass meanwhile.
  if (ch && isHero(ch) && ch.subclass === 'warden') ch.barkskin = Math.max(ch.barkskin, Math.trunc(ch.ht / 3));
  level.map[pos] = huntress ? T.FURROWED_GRASS : T.GRASS;

  // SEAM(artifacts): SandalsOfNature.Naturalism raises this (or a cursed pair makes it -1).
  let naturalism = 0;
  // SEAM(talents): Talent.NATURES_BOUNTY's berries.
  // The fungal mine sheds a third as much (MiningLevel, Blacksmith.Quest.FUNGI).
  if (level.mine === 'fungi' && rng.int(3) !== 0) naturalism = -1;
  if (naturalism < 0) return;

  // A seed, 1/25 to 1/9 (SEAM(alchemy): PetrifiedSeed's multiplier and stone chance, 1 and 0 without it).
  let lootChance = Math.fround(1 / Math.fround(25 - naturalism * 4));
  // The vault sheds far fewer seeds (VaultLevel).
  if (isVault(ctx)) lootChance = Math.fround(lootChance / 3);
  if (rng.float() < lootChance) {
    rng.float(); // Random.Float() < PetrifiedSeed.stoneInsteadOfSeedChance(): never, without the trinket.
    dropItem(ctx.floor, pos, new ItemGenerator(rng, ctx.depth).of('seed'));
  }
  // A dewdrop, 1/6 to 1/4; half as often on a grassy level. Barren land blocks dew (Challenges.isItemBlocked).
  lootChance = Math.fround(1 / Math.fround(6 - naturalism / 2));
  if (level.feeling === Feeling.GRASS) lootChance = Math.fround(lootChance / 2);
  if (rng.float() < lootChance && !isChallenged(ctx.world, NO_HERBALISM)) dropItem(ctx.floor, pos, createItem('dew'));
  // SEAM(gear): Camouflage.activate for whoever wears the glyph.
}

/** VaultLevel: the city's side level (the imp's vault). */
const isVault = (ctx: Ctx): boolean => (ctx.level.branch ?? 0) !== 0 && ctx.depth > 15 && ctx.depth <= 20;
