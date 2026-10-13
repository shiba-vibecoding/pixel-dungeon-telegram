import type { ChampionKind, Mob } from './actors';
import { CHAMPION_ENEMIES, isChallenged } from './challenges';
import { type Char, charAt, type Ctx, isHero, isWater } from './floor';
import { adjacent, distance, LENGTH, NEIGHBOURS8 } from './level/geometry';
import { F, hasFlag } from './level/terrain';
import type { Level } from './level/generate';
import type { Rng } from './rng';
import type { World } from './world';

/*
 * ChampionEnemy, under the «Hostile champions» challenge: one regular monster
 * in eight (one in six from the twenty-first depth) comes as a champion of
 * one of six kinds, with an aura of its colour — blazing (sets alight what
 * it strikes, fire all round as it dies), projecting (strikes from four
 * cells away), antimagic (half the harm, magic does nothing), giant (a fifth
 * of the harm, strikes from two cells away, too large for corridors),
 * blessed (four times as accurate and evasive), growing (a little stronger
 * every four turns).
 */

/** ChampionEnemy.rollForChampion's six, in the order of its Random.Int(6). */
export const CHAMPIONS: readonly ChampionKind[] = ['blazing', 'projecting', 'antiMagic', 'giant', 'blessed', 'growing'];

/** ChampionEnemy.color: the aura's colour, and its rays (for the client). */
export const CHAMPION_AURA: Readonly<Record<ChampionKind, { color: number; rays: number }>> = {
  blazing: { color: 0xff8800, rays: 4 },
  projecting: { color: 0x8800ff, rays: 4 },
  antiMagic: { color: 0x00ff00, rays: 5 },
  giant: { color: 0x0088ff, rays: 5 },
  blessed: { color: 0xffff00, rays: 6 },
  growing: { color: 0xff2222, rays: 6 },
};

/** Dungeon.mobsToChampion at the start of a run. */
const FIRST_CHAMPION = 1;

/**
 * ChampionEnemy.rollForChampion: counts down to the next champion (a kind is rolled every time, so the challenge
 * changes nothing else a level is made of); when it is due and the challenge is on, this monster is one (not a crab
 * before depth 4, a thief before 5, a guard before 8, a bat before 10), and the next comes after eight more,
 * fewer the deeper (six from depth 21). A champion is awake.
 */
export function rollForChampion(world: World, mob: Mob, rng: Rng, depth: number): void {
  world.mobsToChampion = (world.mobsToChampion ?? FIRST_CHAMPION) - 1;
  const kind = CHAMPIONS[rng.int(6)]!;
  if (world.mobsToChampion > 0 || !isChallenged(world, CHAMPION_ENEMIES)) return;
  const family = (k: string): boolean => mob.kind === k;
  if ((family('crab') || family('hermitCrab') || family('greatCrab')) && depth <= 3) return;
  if ((family('thief') || family('bandit')) && depth <= 4) return;
  if (family('guard') && depth <= 7) return;
  if (family('bat') && depth <= 9) return;
  mob.champion = kind;
  if (kind === 'growing') mob.growth = 1.19;
  world.mobsToChampion += 8 - Math.min(20, depth - 1) / 10;
  if (mob.state !== 'passive') mob.state = 'wandering';
}

const championOf = (char: Char): ChampionKind | undefined => (isHero(char) ? undefined : char.champion);

/** ChampionEnemy.meleeDamageFactor: blazing and projecting a quarter more, growing by its multiplier. */
export function meleeDamageFactor(char: Char): number {
  switch (championOf(char)) {
    case 'blazing': case 'projecting': return 1.25;
    case 'growing': return (char as Mob).growth ?? 1.19;
    default: return 1;
  }
}

/** ChampionEnemy.damageTakenFactor: antimagic half, giant a fifth, growing one over its multiplier. */
export function damageTakenFactor(char: Char): number {
  switch (championOf(char)) {
    case 'antiMagic': return 0.5;
    case 'giant': return 0.2;
    case 'growing': return 1 / ((char as Mob).growth ?? 1.19);
    default: return 1;
  }
}

/** ChampionEnemy.evasionAndAccuracyFactor: blessed four times, growing by its multiplier. */
export function evasionAndAccuracyFactor(char: Char): number {
  switch (championOf(char)) {
    case 'blessed': return 4;
    case 'growing': return (char as Mob).growth ?? 1.19;
    default: return 1;
  }
}

/** Char.damage with champions: the harm taken, rounded up in the hero's favour against a champion's reduction. */
export const championDamage = (char: Char, damage: number): number => {
  const factor = damageTakenFactor(char);
  return factor === 1 ? damage : Math.ceil(damage * factor);
};

/**
 * ChampionEnemy.canAttackWithExtraReach (Projecting: four cells, Giant: two): the enemy within that many steps
 * over anything not solid, around everyone else standing in the way.
 */
export function canAttackWithExtraReach(ctx: Ctx, mob: Mob, enemy: Char): boolean {
  const reach = mob.champion === 'projecting' ? 4 : mob.champion === 'giant' ? 2 : 0;
  if (reach === 0 || distance(mob.pos, enemy.pos) > reach) return false;
  return stepsAround(ctx, enemy.pos, mob.pos, reach) <= reach;
}

/**
 * PathFinder.buildDistanceMap(from, passable, limit) where passable is «not solid and nobody there» (`to` itself
 * always passable): the steps from `from` to `to`, or Infinity if more than `limit`.
 */
export function stepsAround(ctx: Ctx, from: number, to: number, limit: number): number {
  const level: Level = ctx.level;
  const dist = new Map<number, number>([[from, 0]]);
  let frontier = [from];
  for (let step = 1; step <= limit && frontier.length > 0; step++) {
    const next: number[] = [];
    for (const c of frontier) {
      for (const n of NEIGHBOURS8) {
        const cell = c + n;
        if (cell < 0 || cell >= LENGTH || dist.has(cell) || !adjacent(c, cell)) continue;
        if (cell === to) return step;
        if (hasFlag(level.map[cell]!, F.SOLID) || charAt(ctx.world, ctx.depth, cell)) continue;
        dist.set(cell, step);
        next.push(cell);
      }
    }
    frontier = next;
  }
  return Infinity;
}

/** ChampionEnemy.Blazing.onAttackProc: what it strikes catches fire, unless it stands in water. */
export function championAttackProc(ctx: Ctx, mob: Mob, enemy: Char, ignite: (char: Char) => void): void {
  if (mob.champion === 'blazing' && !isWater(ctx.level.map[enemy.pos]!)) ignite(enemy);
}

/** ChampionEnemy.Growing.act: a hundredth stronger every four turns. */
export function growChampion(mob: Mob, now: number): void {
  if (mob.champion !== 'growing') return;
  mob.growAt ??= now + 4;
  while (now >= mob.growAt) {
    mob.growth = (mob.growth ?? 1.19) + 0.01;
    mob.growAt += 4;
  }
}

/** Immunities a champion has: a blazing one does not burn; an antimagic one ignores magic. */
export const championImmune = (char: Char, harm: 'burning' | 'magic'): boolean =>
  (harm === 'burning' && championOf(char) === 'blazing') || (harm === 'magic' && championOf(char) === 'antiMagic');
