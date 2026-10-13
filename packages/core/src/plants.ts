import { type Hero, isAlive, MOBS } from './actors';
import { randomRespawnCell } from './ai';
import { charAt, type Char, type Ctx, dropItem, enterCell, type Floor, heroesOn, isHero, leaveCell } from './floor';
import { createItem, ItemGenerator, type ItemKind } from './items';
import { distance, LENGTH } from './level/geometry';
import { T } from './level/terrain';
import { burst } from './traps';
import { chillPack, freezeHeaps } from './cooking';
import { seedPreservation } from './allies';
import { dewcatcher, seedpod } from './regrowth';

/*
 * Plants (Plant and its kinds): a seed thrown somewhere takes root there, and
 * whoever steps on the plant sets it off, using it up.
 */

export type PlantKind =
  | 'firebloom' | 'icecap' | 'sorrowmoss' | 'dreamweed' | 'sungrass' | 'earthroot' | 'fadeleaf' | 'rotberry'
  /** The wand of regrowth's (WandOfRegrowth.Dewcatcher and Seedpod), which grow from no seed one can carry. */
  | 'dewcatcher' | 'seedpod';

export interface PlantInfo {
  pos: number;
  kind: PlantKind;
}

/** The plant each seed grows into; plants.png is in this order. */
export const SEED_PLANTS: Readonly<Partial<Record<ItemKind, PlantKind>>> = {
  'seed.firebloom': 'firebloom',
  'seed.icecap': 'icecap',
  'seed.sorrowmoss': 'sorrowmoss',
  'seed.dreamweed': 'dreamweed',
  'seed.rotberry': 'rotberry',
  'seed.sungrass': 'sungrass',
  'seed.earthroot': 'earthroot',
  'seed.fadeleaf': 'fadeleaf',
};
export const PLANT_KINDS: readonly PlantKind[] = [
  'firebloom', 'icecap', 'sorrowmoss', 'dreamweed', 'sungrass', 'earthroot', 'fadeleaf', 'rotberry', 'dewcatcher', 'seedpod',
];

/** The seed each plant grows from. */
const PLANT_SEEDS: Readonly<Partial<Record<PlantKind, ItemKind>>> = Object.fromEntries(
  Object.entries(SEED_PLANTS).map(([seed, kind]) => [kind, seed]),
) as Partial<Record<PlantKind, ItemKind>>;

/** Frost.DURATION and Vertigo.DURATION. */
const FROZEN_TURNS = 5;
const DIZZY_TURNS = 10;

/** Level.plant: a new plant replaces whatever grew there, and bare ground turns to grass. */
export function plant(ctx: Ctx, pos: number, kind: PlantKind): void {
  const { floor, level } = ctx;
  floor.plants = (floor.plants ?? []).filter((p) => p.pos !== pos);
  floor.plants.push({ pos, kind });
  const terrain = level.map[pos];
  if (terrain === T.EMPTY || terrain === T.EMBERS || terrain === T.EMPTY_DECO || terrain === T.HIGH_GRASS) level.map[pos] = T.GRASS;
  ctx.effects.push({ type: 'planted', depth: ctx.depth, pos, kind });
}

/** Level.uproot: the plant on a cell is gone, unused. */
export function uproot(floor: Floor, pos: number): void {
  floor.plants = (floor.plants ?? []).filter((p) => p.pos !== pos);
}

const near = (ctx: Ctx, pos: number, radius: number): Char[] => [
  ...heroesOn(ctx.world, ctx.depth).filter((h) => distance(h.pos, pos) <= radius),
  ...ctx.floor.mobs.filter((m) => m.state !== 'passive' && distance(m.pos, pos) <= radius),
];

/**
 * Level.press / mobPress: whoever steps on a plant sets it off; so does an item landing on it (`who` null).
 * `activate`: set off on whoever is there, flier or not (Plant.activate, as the sandals of nature do it).
 */
export function stepOnPlant(ctx: Ctx, who: Char | null, pos: number, activate = false): void {
  const found = ctx.floor.plants?.find((p) => p.pos === pos);
  if (!found) return;
  // Flying creatures pass over plants without touching them.
  if (who && !isHero(who) && MOBS[who.kind].flying && !activate) return;
  ctx.floor.plants = ctx.floor.plants!.filter((p) => p !== found);
  ctx.effects.push({ type: 'plantTriggered', depth: ctx.depth, pos, kind: found.kind, who: who?.id ?? '' });
  const { world, depth, level, rng } = ctx;
  // Plant.activate and wither: a warden draws bark from it, and now and then a seed or a dewdrop.
  if (who && isHero(who) && who.subclass === 'warden') {
    who.barkskin = Math.max(who.barkskin, Math.trunc(who.ht / 3));
    if (rng.int(5) === 0) dropItem(ctx.floor, pos, new ItemGenerator(rng, depth).of('seed'));
    if (rng.int(5) === 0) dropItem(ctx.floor, pos, createItem('dew'));
  }
  // Plant.wither: within a lotus's reach, the plant may leave its seed behind (never a rotberry's).
  const preserved = seedPreservation(ctx, pos);
  if (preserved > 0 && rng.float() < preserved) {
    const seed = PLANT_SEEDS[found.kind];
    if (seed && found.kind !== 'rotberry') dropItem(ctx.floor, pos, createItem(seed));
  }
  switch (found.kind) {
    case 'firebloom':
      burst(ctx, pos, 'fire', 0);
      break;
    case 'icecap':
      // Everyone around freezes in place, and fires go out.
      for (const char of near(ctx, pos, 1)) {
        char.paralysed = Math.max(char.paralysed ?? 0, FROZEN_TURNS);
        char.burning = 0;
        if (isHero(char)) chillPack(ctx, char);
      }
      freezeHeaps(ctx, pos, 1);
      break;
    case 'sorrowmoss':
      if (who) who.poison = Math.max(who.poison ?? 0, 4 + Math.trunc(depth / 2));
      break;
    case 'dreamweed':
      // A cloud of confusion gas: everyone in it staggers about for a while.
      for (const char of near(ctx, pos, 2)) char.dizzy = Math.max(char.dizzy ?? 0, DIZZY_TURNS);
      break;
    case 'sungrass':
      if (who && isHero(who)) {
        who.sungrass = pos;
        who.sungrassTime = 0;
      }
      break;
    case 'earthroot':
      if (who && isHero(who)) who.earthroot = { pos, level: who.ht };
      break;
    case 'fadeleaf': {
      // The one who stepped on it is carried off somewhere else on the level.
      if (!who) break;
      const to = randomRespawnCell(rng, world, level, (cell) => cell !== who.pos);
      if (to === -1 || charAt(world, depth, to)) break;
      const from = who.pos;
      who.pos = to;
      leaveCell(world, level, depth, from);
      enterCell(level, to);
      if (isHero(who)) ctx.effects.push({ type: 'teleported', hero: who.id });
      else ctx.effects.push({ type: 'jumped', depth, mob: who.id, from, to });
      break;
    }
    case 'dewcatcher':
      dewcatcher(ctx, pos);
      break;
    case 'seedpod':
      seedpod(ctx, pos);
      break;
    case 'rotberry':
      // Its berries taste like sweet, sweet death: a cloud of toxic gas, roots for whoever stepped on it, and its seed.
      burst(ctx, pos, 'toxic', 2, false, 100);
      if (who && isHero(who)) who.rooted = Math.max(who.rooted, 3);
      dropItem(ctx.floor, pos, createItem('seed.rotberry'));
      break;
  }
}

/** Sungrass.Health: standing still on the spot, a tenth of one's health back every five turns. */
export function sungrassHeals(hero: Hero, time: number): void {
  if (hero.sungrass === undefined || hero.sungrass < 0) return;
  if (hero.pos !== hero.sungrass || hero.hp >= hero.ht || !isAlive(hero)) {
    hero.sungrass = -1;
    return;
  }
  hero.sungrassTime = (hero.sungrassTime ?? 0) + time;
  while (hero.sungrassTime >= 5 && hero.hp < hero.ht) {
    hero.sungrassTime -= 5;
    hero.hp = Math.min(hero.ht, hero.hp + Math.trunc(hero.ht / 10));
  }
}

/** Earthroot.Armor: while the hero stays put, the bark takes the blows, up to its strength. */
export function earthrootAbsorbs(hero: Hero, damage: number): number {
  const bark = hero.earthroot;
  if (!bark) return damage;
  if (hero.pos !== bark.pos) {
    hero.earthroot = null;
    return damage;
  }
  if (damage >= bark.level) {
    hero.earthroot = null;
    return damage - bark.level;
  }
  bark.level -= damage;
  return 0;
}

/** Vertigo: a dizzy creature goes somewhere it did not mean to. */
export function staggerTarget(ctx: Ctx, from: number): number {
  const cells = [-1, 1, -32, 32, -33, -31, 31, 33].map((n) => from + n).filter((c) => c >= 0 && c < LENGTH && distance(c, from) === 1);
  return ctx.rng.element(cells) ?? from;
}

