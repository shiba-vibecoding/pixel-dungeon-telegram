import { createItem } from './items';
import { ItemGenerator } from './items';
import { type Char, type Ctx, dropItem, isHero } from './floor';
import { Feeling } from './level/gen/dungeon';
import { T } from './level/terrain';
import type { Level } from './level/generate';
import { isChallenged, NO_HERBALISM } from './challenges';
import { naturalism } from './artifacts/sandals';
import { camouflage } from './enchant';
import { onGrassTrampled } from './talents/nature';
import { PETRIFIED_SEED, trinketLevel } from './trinkets';

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
  const hero = ch !== null && isHero(ch) ? ch : undefined;
  const huntress = hero?.heroClass === 'huntress';
  if (level.map[pos] === T.FURROWED_GRASS) {
    // Furrowed already: the huntress leaves it so, anyone else flattens it; it sheds nothing.
    if (!huntress) level.map[pos] = T.GRASS;
    if (hero) camouflage(hero);
    return;
  }
  if (level.map[pos] !== T.HIGH_GRASS) return;
  level.map[pos] = huntress ? T.FURROWED_GRASS : T.GRASS;

  // SandalsOfNature.Naturalism: worn, more is found (its level + 1); cursed, nothing at all.
  let nature = naturalism(hero) ?? 0;
  // Talent.NATURES_BOUNTY's berries, and the huntress's barkskin (talents/nature.ts).
  if (hero) onGrassTrampled(ctx, hero, pos);
  // The fungal mine sheds a third as much (MiningLevel, Blacksmith.Quest.FUNGI).
  if (level.mine === 'fungi' && rng.int(3) !== 0) nature = -1;
  if (nature >= 0) {
    // A seed, 1/25 to 1/9; PetrifiedSeed: more found, and a runestone now and then instead of a seed.
    const petrified = trinketLevel(hero, 'trinket.petrifiedSeed');
    let lootChance = Math.fround(1 / Math.fround(25 - nature * 4));
    if (petrified >= 0) lootChance = Math.fround(lootChance * PETRIFIED_SEED.grassLootMultiplier(petrified));
    // The vault sheds far fewer seeds (VaultLevel).
    if (isVault(ctx)) lootChance = Math.fround(lootChance / 3);
    if (rng.float() < lootChance) {
      const stone = rng.float() < (petrified >= 0 ? PETRIFIED_SEED.stoneInsteadOfSeedChance(petrified) : 0);
      dropItem(ctx.floor, pos, new ItemGenerator(rng, ctx.depth).of(stone ? 'stone' : 'seed'));
    }
    // A dewdrop, 1/6 to 1/4; half as often on a grassy level. Barren land blocks dew (Challenges.isItemBlocked).
    lootChance = Math.fround(1 / Math.fround(6 - nature / 2));
    if (level.feeling === Feeling.GRASS) lootChance = Math.fround(lootChance / 2);
    if (rng.float() < lootChance && !isChallenged(ctx.world, NO_HERBALISM)) dropItem(ctx.floor, pos, createItem('dew'));
  }
  // Camouflage.activate for whoever wears the glyph.
  if (hero) camouflage(hero);
}

/** VaultLevel: the city's side level (the imp's vault). */
const isVault = (ctx: Ctx): boolean => (ctx.level.branch ?? 0) !== 0 && ctx.depth > 15 && ctx.depth <= 20;

/** Level.set(pos, FURROWED_GRASS) for the talents and the warden: tall grass that still stands, and sheds nothing. */
export function furrowGrass(level: Level, pos: number): void {
  level.map[pos] = T.FURROWED_GRASS;
}
