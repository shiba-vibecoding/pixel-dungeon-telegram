import { describe, expect, it } from 'vitest';
import {
  act, type Action, addHero, adjacent, canEnter, charAt, createItem, createMob, createWorld, distance, type Effect, floorAt,
  heroById, HALLS_EXIT, isAlive, isFist, levelAt, type Mob, NEIGHBOURS8, STRONGER_BOSSES, WIDTH, type World,
} from '../src/index';
import { Rng } from '../src/rng';
import type { Ctx } from '../src/floor';
import { bossAfterDamage } from '../src/bosses';

/*
 * Challenges.STRONGER_BOSSES for Yog-Dzewa, his fists and minions: two fists rise at a time, the death
 * rays hit for 30 to 50, the summons are eyes, scorpions, larvae and ripper demons, and the hero's
 * LockedFloor is refilled more slowly by damage dealt (a third for Yog, a quarter for a fist).
 */

/** A sturdy hero on the halls' floor (depth 25), two demon spawners left alive above. */
function hall(challenges: number, seed = 3): World {
  const world = createWorld(seed, challenges);
  addHero(world, { id: 'p', name: 'P', heroClass: 'warrior' });
  for (let d = 1; d <= 25; d++) levelAt(world, d);
  for (let d = 1; d < 25; d++) floorAt(world, d).mobs = [];
  floorAt(world, 21).mobs.push(createMob('sp1', 'spawner', 0, 'passive', 0));
  floorAt(world, 22).mobs.push(createMob('sp2', 'spawner', 0, 'passive', 0));
  const hero = heroById(world, 'p')!;
  Object.assign(hero, { depth: 25, pos: levelAt(world, 25).entrance, time: floorAt(world, 25).now, lvl: 20, ht: 5000, hp: 5000, attackSkill: 1e6, defenseSkill: 1e6 });
  hero.weapon = createItem('weapon.shortsword', 1, 0);
  return world;
}

const hero = (world: World) => heroById(world, 'p')!;
const floorOf = (world: World) => floorAt(world, 25);
const yogOf = (world: World): Mob => floorOf(world).mobs.find((m) => m.kind === 'yog')!;

function play(world: World, action: Action): Effect[] {
  let result = act(world, 'p', action);
  if (!result.ok) result = act(world, 'p', { type: 'wait' });
  const h = hero(world);
  if (h.hp > 0) h.hp = h.ht;
  h.paralysed = 0;
  h.hunger = 0;
  return result.ok ? result.effects : [];
}

function besides(world: World, at: number): void {
  const level = levelAt(world, 25);
  const free = NEIGHBOURS8.map((n) => at + n).find((c) => canEnter(level, c) && !charAt(world, 25, c));
  if (free !== undefined) hero(world).pos = free;
}

function strike(world: World, target: Mob): Effect[] {
  if (!adjacent(hero(world).pos, target.pos)) besides(world, target.pos);
  return play(world, { type: 'attack', target: target.id });
}

/** Two steps off the stairs: the hall seals and Yog rises. */
function seal(world: World): void {
  const level = levelAt(world, 25);
  hero(world).pos = NEIGHBOURS8.map((n) => level.entrance + n).find((c) => canEnter(level, c))!;
  play(world, { type: 'move', to: NEIGHBOURS8.map((n) => hero(world).pos + n).find((c) => canEnter(level, c) && distance(c, level.entrance) >= 2)! });
}

/** Sealed, and next to Yog: the fight begins (phase 1). */
function startFight(world: World): Mob {
  seal(world);
  const yog = yogOf(world);
  besides(world, yog.pos);
  play(world, { type: 'wait' });
  expect(yog.boss?.phase).toBe(1);
  return yog;
}

const ctxOf = (world: World): Ctx => {
  const floor = floorOf(world);
  return { world, depth: 25, level: levelAt(world, 25), floor, rng: new Rng(floor.rng), effects: [] };
};

const PAIRS = [['burningFist', 'soiledFist'], ['rottingFist', 'rustedFist'], ['brightFist', 'darkFist']];
const pairOf = (kind: string): number => PAIRS.findIndex((p) => p.includes(kind));
const sorted = (list: readonly string[] | undefined): string[] => [...(list ?? [])].sort();

describe('STRONGER_BOSSES: Yog-Dzewa', () => {
  it('is dealt six summons (eyes, scorpions, larvae, ripper demons) and a second fist for each phase, never two of a pair together', () => {
    const plain = hall(0);
    const strong = hall(STRONGER_BOSSES);
    seal(plain);
    seal(strong);
    const a = yogOf(plain).boss!;
    const b = yogOf(strong).boss!;
    // Without the challenge: four summons, a ripper demon for each of the two spawners left alive.
    expect(sorted(a.regularSummons)).toEqual(['larva', 'larva', 'ripper', 'ripper']);
    expect(a.challengeSummons).toBeUndefined();
    // With it: six; the first four an eye and a scorpion (spawners alive) and two larvae, the last two ripper demons.
    expect(sorted(b.regularSummons)).toEqual(['eye', 'larva', 'larva', 'ripper', 'ripper', 'scorpio']);
    // The same fists come in the same order; the challenge adds their pairs.
    expect(b.fistSummons).toEqual(a.fistSummons);
    expect(b.challengeSummons).toHaveLength(3);
    for (let i = 0; i < 3; i++) expect(pairOf(b.challengeSummons![i]!)).not.toBe(pairOf(b.fistSummons![i]!));
    expect(new Set(b.challengeSummons!.map(pairOf)).size).toBe(3);
    // Fist i comes with the pair of the fist drawn after it (or two after it): [1, 2, 0] or [2, 0, 1].
    const first = b.fistSummons!.map(pairOf);
    const second = b.challengeSummons!.map(pairOf);
    const ok1 = second[0] === first[1] && second[1] === first[2] && second[2] === first[0];
    const ok2 = second[0] === first[2] && second[1] === first[0] && second[2] === first[1];
    expect(ok1 || ok2).toBe(true);
    // And each is the partner of its pair, not the fist itself.
    for (let i = 0; i < 3; i++) expect(b.challengeSummons![i]).not.toBe(b.fistSummons![i]);
  });

  it('raises two fists at a time, never straight below the pit', () => {
    const world = hall(STRONGER_BOSSES);
    const yog = startFight(world);
    const first = [...yog.boss!.fistSummons!];
    const second = [...yog.boss!.challengeSummons!];
    for (let phase = 1; phase <= 3; phase++) {
      yog.hp = yog.ht - 300 * phase + 5;
      for (let i = 0; i < 30 && yog.boss?.phase === phase; i++) strike(world, yog);
      expect(yog.boss?.phase).toBe(phase + 1);
      const fists = floorOf(world).mobs.filter((m) => isFist(m) && isAlive(m));
      expect(fists.map((f) => f.kind).sort(), `phase ${phase}`).toEqual([first[phase - 1]!, second[phase - 1]!].sort());
      expect(fists.some((f) => f.pos === HALLS_EXIT + WIDTH)).toBe(false);
      expect(new Set(fists.map((f) => f.pos)).size).toBe(2);
      // Clear them away to reach the next phase.
      floorOf(world).mobs = floorOf(world).mobs.filter((m) => !isFist(m));
      yog.boss!.phase = phase + 1;
    }
    expect(yog.boss!.fistSummons).toEqual([]);
    expect(yog.boss!.challengeSummons).toEqual([]);
  });

  it('raises a single fist, straight below the pit, without the challenge', () => {
    const world = hall(0);
    const yog = startFight(world);
    yog.hp = yog.ht - 300 + 5;
    for (let i = 0; i < 30 && yog.boss?.phase === 1; i++) strike(world, yog);
    const fists = floorOf(world).mobs.filter(isFist);
    expect(fists).toHaveLength(1);
    expect(fists[0]!.pos).toBe(HALLS_EXIT + WIDTH);
  });

  it('fires death rays for 30 to 50 under the challenge, 20 to 30 without', () => {
    for (const [challenges, lo, hi] of [[STRONGER_BOSSES, 30, 50], [0, 20, 30]] as const) {
      const world = hall(challenges, 4);
      const yog = startFight(world);
      const hits: number[] = [];
      for (let i = 0; i < 300 && hits.length < 12; i++) {
        for (const e of play(world, { type: 'wait' })) {
          if (e.type === 'attack' && e.attacker === yog.id && e.hit) hits.push(e.damage);
        }
      }
      expect(hits.length).toBeGreaterThanOrEqual(5);
      for (const d of hits) {
        expect(d).toBeGreaterThanOrEqual(lo);
        expect(d).toBeLessThanOrEqual(hi);
      }
      if (challenges) expect(Math.max(...hits)).toBeGreaterThan(30);
    }
  });

  it('gives back a third of the damage dealt to Yog and a quarter for a fist as LockedFloor time (a half without)', () => {
    for (const [challenges, yogShare, fistShare] of [[STRONGER_BOSSES, 1 / 3, 1 / 4], [0, 1 / 2, 1 / 2]] as const) {
      const world = hall(challenges);
      const yog = startFight(world);
      const ctx = ctxOf(world);
      hero(world).lockedFloor = 5;
      const before = yog.hp;
      yog.hp -= 30;
      bossAfterDamage(ctx, yog, before, 'magic');
      expect(hero(world).lockedFloor).toBeCloseTo(5 + 30 * yogShare, 5);

      const fist = createMob('f1', 'rottingFist', HALLS_EXIT + 20 * WIDTH, 'hunting', 0);
      floorOf(world).mobs.push(fist);
      hero(world).lockedFloor = 5;
      const fistBefore = fist.hp;
      fist.hp -= 24;
      bossAfterDamage(ctx, fist, fistBefore, 'magic');
      expect(hero(world).lockedFloor).toBeCloseTo(5 + 24 * fistShare, 5);
    }
  });

  it('summons the eyes and scorpions as boss minions, and they die with Yog', () => {
    const world = hall(STRONGER_BOSSES, 5);
    const yog = startFight(world);
    yog.boss!.regularSummons = ['eye', 'scorpio', 'larva', 'ripper', 'ripper', 'larva'];
    const seen = new Set<string>();
    for (let i = 0; i < 400 && seen.size < 2; i++) {
      yog.boss!.summonCooldown = 0;
      play(world, { type: 'wait' });
      for (const m of floorOf(world).mobs) if (m.bossMinion && isAlive(m) && (m.kind === 'eye' || m.kind === 'scorpio')) seen.add(m.kind);
    }
    expect([...seen].sort()).toEqual(['eye', 'scorpio']);
    // Yog's last breath takes them with him.
    yog.boss!.phase = 5;
    yog.hp = 1;
    for (let i = 0; i < 20 && isAlive(yog); i++) strike(world, yog);
    expect(isAlive(yog)).toBe(false);
    expect(floorOf(world).mobs.some((m) => m.bossMinion && isAlive(m) && (m.kind === 'eye' || m.kind === 'scorpio'))).toBe(false);
  });
});
