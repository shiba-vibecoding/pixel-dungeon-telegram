import { describe, expect, it } from 'vitest';
import {
  act, type Action, addHero, adjacent, BOTTOM_DOOR, canEnter, charAt, createItem, createWorld, type Effect, floorAt, heroById, isAlive,
  levelAt, type Mob, NEIGHBOURS8, THRONE, WIDTH, type World,
} from '../src/index';
import { STRONGER_BOSSES } from '../src/challenges';
import { checkInvariants } from './helpers';

/*
 * «Badder bosses» (Challenges.STRONGER_BOSSES) against the Dwarf King and his court (DwarfKing.java): 450 health
 * and a floor of 100, quicker abilities and summons, golems among the subjects, eighteen subjects in the throne
 * phase, each worth an eighteenth of the shield, and a faster summoning in the last phase.
 */

function atBoss(challenges: number, seed = 3): World {
  const world = createWorld(seed, challenges);
  addHero(world, { id: 'p', name: 'P', heroClass: 'warrior' });
  for (let d = 1; d <= 20; d++) levelAt(world, d);
  for (let d = 1; d < 20; d++) floorAt(world, d).mobs = [];
  const hero = heroById(world, 'p')!;
  Object.assign(hero, { depth: 20, pos: levelAt(world, 20).entrance, time: floorAt(world, 20).now, lvl: 20, ht: 5000, hp: 5000, attackSkill: 1e6, defenseSkill: 1e6 });
  hero.weapon = createItem('weapon.shortsword', 1, 0);
  return world;
}

const hero = (world: World) => heroById(world, 'p')!;
const floorOf = (world: World) => floorAt(world, 20);
const kingOf = (world: World): Mob => floorOf(world).mobs.find((m) => m.kind === 'king')!;

function play(world: World, action: Action): Effect[] {
  let result = act(world, 'p', action);
  if (!result.ok) result = act(world, 'p', { type: 'wait' });
  const h = hero(world);
  if (h.hp > 0) h.hp = h.ht;
  h.paralysed = 0;
  h.hunger = 0;
  checkInvariants(world);
  return result.ok ? result.effects : [];
}

function strike(world: World, target: Mob): Effect[] {
  if (!adjacent(hero(world).pos, target.pos)) {
    const level = levelAt(world, 20);
    const free = NEIGHBOURS8.map((n) => target.pos + n).find((c) => canEnter(level, c) && !charAt(world, 20, c));
    if (free !== undefined) hero(world).pos = free;
  }
  return play(world, { type: 'attack', target: target.id });
}

/** The hero steps through the throne room's door; the King appears. */
function inThroneRoom(challenges: number, seed = 3): World {
  const world = atBoss(challenges, seed);
  hero(world).pos = BOTTOM_DOOR;
  play(world, { type: 'move', to: BOTTOM_DOOR - WIDTH });
  return world;
}

/** Wounds the King to just above his floor and strikes until he takes his throne. */
function toThrone(world: World, above: number, effects: Effect[] = []): Mob {
  const king = kingOf(world);
  king.hp = above;
  for (let i = 0; i < 20 && king.boss?.phase === 1; i++) effects.push(...strike(world, king));
  expect(king.boss?.phase).toBe(2);
  return king;
}

const yelled = (effects: Effect[], line: string): boolean => effects.some((e) => e.type === 'yell' && e.line === line);
const court = (world: World): Mob[] => floorOf(world).mobs.filter((m) => m.bossMinion);

describe('Badder bosses: the Dwarf King', () => {
  it('is made with 450 health instead of 300', () => {
    expect(kingOf(inThroneRoom(0)).ht).toBe(300);
    const king = kingOf(inThroneRoom(STRONGER_BOSSES));
    expect(king.ht).toBe(450);
    expect(king.hp).toBe(450);
  });

  it('sets his health floor at 100 instead of 50, and his shield is as great as his health', () => {
    const world = inThroneRoom(STRONGER_BOSSES);
    const king = toThrone(world, 105);
    expect(king.hp).toBe(100);
    expect(king.pos).toBe(THRONE);
    expect(king.shield).toBe(450);
  });

  it('summons faster in his first phase: a delay of two turns, a cooldown of 8-10', () => {
    // (He summons the turn the doors lock, before the hero's next move.)
    const seen = (challenges: number): { delay: number; cooldown: number } => {
      const world = inThroneRoom(challenges);
      const s = floorOf(world).boss!.timed.find((t) => t.kind === 'summoning');
      if (!s || s.kind !== 'summoning') throw new Error('no summoning');
      return { delay: s.delay, cooldown: kingOf(world).boss!.summonCooldown! };
    };
    const hard = seen(STRONGER_BOSSES);
    const easy = seen(0);
    // (One turn of the summoning has already passed: three turns' delay is two left, two turns' is one.)
    expect(easy.delay - hard.delay).toBe(1);
    expect(hard.delay).toBeLessThanOrEqual(2);
    expect(hard.cooldown).toBeGreaterThanOrEqual(8);
    expect(hard.cooldown).toBeLessThanOrEqual(10);
    expect(easy.cooldown).toBeGreaterThanOrEqual(10);
    expect(easy.cooldown).toBeLessThanOrEqual(14);
  });

  it('calls a monk or a warlock as every third subject, and a golem as every ninth', () => {
    const next = (challenges: number, made: number): string => {
      const world = inThroneRoom(challenges);
      const king = kingOf(world);
      floorOf(world).boss!.timed = floorOf(world).boss!.timed.filter((t) => t.kind !== 'summoning');
      king.boss!.summonsMade = made;
      king.boss!.summonCooldown = 0;
      for (let i = 0; i < 3; i++) {
        play(world, { type: 'wait' });
        const s = floorOf(world).boss!.timed.find((t) => t.kind === 'summoning');
        if (s && s.kind === 'summoning') return s.summon;
      }
      throw new Error('no summoning');
    };
    const hard = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((made) => next(STRONGER_BOSSES, made));
    expect(hard.map((k) => (k === 'monk' || k === 'warlock' ? 'mw' : k))).toEqual(['ghoul', 'ghoul', 'mw', 'ghoul', 'ghoul', 'mw', 'ghoul', 'ghoul', 'golem']);
    // Without the challenge it is every fourth, and no golem.
    const easy = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((made) => next(0, made));
    expect(easy.map((k) => (k === 'monk' || k === 'warlock' ? 'mw' : k))).toEqual(['ghoul', 'ghoul', 'ghoul', 'mw', 'ghoul', 'ghoul', 'ghoul', 'mw', 'ghoul']);
  });

  it('in the throne phase summons eighteen subjects in four waves, as his shield goes down', () => {
    const world = inThroneRoom(STRONGER_BOSSES);
    const all: Effect[] = [];
    const king = toThrone(world, 105, all);
    const kinds = new Map<string, string>();
    const wait = (turns: number): void => {
      for (let i = 0; i < turns; i++) {
        all.push(...play(world, { type: 'wait' }));
        for (const m of court(world)) kinds.set(m.id, m.kind);
      }
    };
    const count = (kind: string): number => [...kinds.values()].filter((k) => k === kind).length;
    // Wave one: two ghouls a call, three calls.
    wait(12);
    expect(yelled(all, 'wave_1')).toBe(true);
    expect(king.boss!.summonsMade).toBe(6);
    expect(count('ghoul')).toBeGreaterThanOrEqual(4);
    expect(yelled(all, 'wave_2')).toBe(false);
    // The shield holds until it is down to two thirds.
    wait(10);
    expect(king.boss!.summonsMade).toBe(6);
    king.shield = 300;
    wait(10);
    expect(yelled(all, 'wave_2')).toBe(true);
    expect(king.boss!.summonsMade).toBe(12);
    expect(count('monk') + count('warlock')).toBeGreaterThanOrEqual(2);
    expect(yelled(all, 'wave_3')).toBe(false);
    // Wave three at a third: a warlock, a monk, two ghouls; then two golems.
    king.shield = 150;
    wait(12);
    expect(yelled(all, 'wave_3')).toBe(true);
    expect(king.boss!.summonsMade).toBe(18);
    expect(count('golem')).toBe(2);
    // Every subject summoned now carries the KingDamager.
    expect(court(world).filter((m) => m.boss?.kingDamager).length).toBeGreaterThan(0);
  });

  it('loses an eighteenth of his shield for each subject slain', () => {
    const world = inThroneRoom(STRONGER_BOSSES);
    const king = toThrone(world, 105);
    for (let i = 0; i < 30 && !court(world).some((m) => m.boss?.kingDamager); i++) play(world, { type: 'wait' });
    const subject = court(world).find((m) => m.boss?.kingDamager)!;
    expect(subject).toBeDefined();
    subject.kind = 'monk';
    subject.partner = undefined;
    subject.hp = 1;
    const before = king.shield!;
    strike(world, subject);
    expect(isAlive(subject)).toBe(false);
    expect(before - king.shield!).toBe(25);
  });

  it('summons faster in his last phase', () => {
    const delayOf = (challenges: number): number => {
      const world = inThroneRoom(challenges);
      const king = kingOf(world);
      king.boss!.phase = 3;
      king.boss!.summonsMade = 1;
      floorOf(world).boss!.timed = floorOf(world).boss!.timed.filter((t) => t.kind !== 'summoning');
      for (let i = 0; i < 10; i++) {
        play(world, { type: 'wait' });
        const s = floorOf(world).boss!.timed.find((t) => t.kind === 'summoning');
        if (s && s.kind === 'summoning') return s.delay;
      }
      throw new Error('no summoning');
    };
    expect(delayOf(STRONGER_BOSSES)).toBeLessThan(delayOf(0));
  });

  it('gives back less locked-floor time for his wounds: a fifth of the damage rather than a third', () => {
    const regained = (challenges: number): number => {
      const world = inThroneRoom(challenges);
      const king = kingOf(world);
      hero(world).lockedFloor = 5;
      king.hp = king.ht;
      const before = king.hp;
      strike(world, king);
      const taken = before - king.hp;
      expect(taken).toBeGreaterThan(0);
      return (hero(world).lockedFloor! - 5 + 1) / taken;
    };
    expect(regained(STRONGER_BOSSES)).toBeCloseTo(1 / 5, 1);
    expect(regained(0)).toBeCloseTo(1 / 3, 1);
  });
});
