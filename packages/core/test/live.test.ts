import { describe, expect, it } from 'vitest';
import {
  act, addHero, canEnter, charAt, createMob, createWorld, exploredCells, F, findPath, floorAt, hasFlag, heroById, inFight, isAlive, levelAt,
  liveReady, liveTick, liveWaiting, type Mob, NEIGHBOURS8, T, WIDTH, type World,
} from '../src/index';
import { pacify } from './helpers';

/** A live world with one hero (or more) on the first depth, nothing awake about; the party knows the depth. */
function live(players = 1): World {
  const world = pacify(createWorld(5, 0, 'dungeon', true));
  for (let i = 0; i < players; i++) addHero(world, { id: `p${i}`, name: `P${i}`, heroClass: 'warrior' });
  world.explored[1] = levelAt(world, 1).map.map(() => true);
  // Everyone in sight of everyone about the entrance: no tall grass in the way.
  const level = levelAt(world, 1);
  level.map = level.map.map((t) => (t === T.HIGH_GRASS || t === T.FURROWED_GRASS ? T.GRASS : t));
  return world;
}

/** A free cell the party knows, some steps away along an open path. */
function farCell(world: World, from: number, steps: number): number {
  const level = levelAt(world, 1);
  const known = exploredCells(world, 1);
  for (let cell = 0; cell < level.map.length; cell++) {
    const path = canEnter(level, cell) && !charAt(world, 1, cell) ? findPath(level, from, cell, new Set(), known) : null;
    if (path && path.length === steps) return cell;
  }
  throw new Error('no such cell');
}

/** A rat after `heroId`, `away` cells from them along an open line. */
function ratAfter(world: World, heroId: string, away: number, id = 'r1'): Mob {
  const hero = heroById(world, heroId)!;
  const level = levelAt(world, 1);
  // In plain sight: no tall grass in between.
  const clear = (c: number): boolean => canEnter(level, c) && !charAt(world, 1, c) && !hasFlag(level.map[c]!, F.LOS_BLOCKING);
  const n = NEIGHBOURS8.find((d) => [...Array(away).keys()].every((k) => clear(hero.pos + (k + 1) * d)))!;
  const rat = createMob(id, 'rat', hero.pos + away * n, 'hunting', 1);
  rat.enemy = hero.id;
  floorAt(world, 1).mobs.push(rat);
  return rat;
}

describe('live turns', () => {
  it('calm, carry an order out a step a beat, and stand still when nobody has anything to do', () => {
    const world = live();
    const hero = heroById(world, 'p0')!;
    expect(liveReady(world, 1)).toBe(false);
    const goal = farCell(world, hero.pos, 4);
    expect(act(world, 'p0', { type: 'plan', steps: [{ type: 'go', to: goal }] }).ok).toBe(true);
    expect(hero.time).toBe(0);
    for (let i = 0; i < 4; i++) {
      expect(liveReady(world, 1)).toBe(true);
      liveTick(world, 1);
    }
    expect(hero.pos).toBe(goal);
    expect(liveReady(world, 1)).toBe(false);
  });

  it('calm, never hold a walker up for a companion who does nothing', () => {
    const world = live(2);
    const walker = heroById(world, 'p0')!;
    const goal = farCell(world, walker.pos, 3);
    act(world, 'p0', { type: 'plan', steps: [{ type: 'go', to: goal }] });
    for (let i = 0; i < 3; i++) liveTick(world, 1);
    expect(walker.pos).toBe(goal);
  });

  it('in a fight, wait for the hero to say what to do: monsters do not move meanwhile', () => {
    const world = live();
    const hero = heroById(world, 'p0')!;
    const rat = ratAfter(world, 'p0', 2);
    expect(inFight(world, 1)).toBe(true);
    expect(liveWaiting(world, 1)).toEqual(['p0']);
    expect(liveReady(world, 1)).toBe(false);
    const at = rat.pos;
    for (let i = 0; i < 5; i++) liveTick(world, 1);
    expect(rat.pos).toBe(at);
    expect(hero.hp).toBe(hero.ht);
    // Told to wait, a turn goes by; then the fight waits again.
    act(world, 'p0', { type: 'wait' });
    expect(liveReady(world, 1)).toBe(true);
    liveTick(world, 1);
    expect(liveWaiting(world, 1)).toEqual(['p0']);
    for (let i = 0; i < 3 && rat.pos === at; i++) {
      act(world, 'p0', { type: 'wait' });
      liveTick(world, 1);
    }
    expect(rat.pos).not.toBe(at);
  });

  it('a tap on a monster is a walk up to it and one blow; the hero never fights by itself', () => {
    const world = live();
    const hero = heroById(world, 'p0')!;
    const rat = ratAfter(world, 'p0', 1);
    rat.ht = rat.hp = 1000;
    act(world, 'p0', { type: 'plan', steps: [{ type: 'hunt', target: 'r1' }] });
    liveTick(world, 1);
    expect(hero.plan).toEqual([]);
    const hp = rat.hp;
    for (let i = 0; i < 5; i++) liveTick(world, 1);
    expect(rat.hp).toBe(hp);
    expect(isAlive(rat)).toBe(true);
  });

  it('in a fight, plays everyone\'s moves together once all have said, a walker counting as said', () => {
    const world = live(3);
    const [a, b, c] = ['p0', 'p1', 'p2'].map((id) => heroById(world, id)!);
    ratAfter(world, 'p0', 2);
    const goal = farCell(world, c!.pos, 5);
    act(world, 'p2', { type: 'plan', steps: [{ type: 'go', to: goal }] });
    expect(liveWaiting(world, 1).sort()).toEqual(['p0', 'p1']);
    act(world, 'p0', { type: 'wait' });
    expect(liveReady(world, 1)).toBe(false);
    act(world, 'p1', { type: 'wait' });
    expect(liveReady(world, 1)).toBe(true);
    const before = c!.pos;
    liveTick(world, 1);
    expect(c!.pos).not.toBe(before);
    expect(a!.plan).toEqual([]);
    expect(b!.plan).toEqual([]);
  });

  it('a key held down walks on until something is in the way, and never fights', () => {
    const world = live();
    const hero = heroById(world, 'p0')!;
    const level = levelAt(world, 1);
    const dir = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([dx, dy]) => canEnter(level, hero.pos + dx! + dy! * WIDTH))!;
    const start = hero.pos;
    act(world, 'p0', { type: 'plan', steps: [{ type: 'stride', dx: dir[0]!, dy: dir[1]! }] });
    for (let i = 0; i < 40 && liveReady(world, 1); i++) liveTick(world, 1);
    expect(hero.pos).not.toBe(start);
    expect(hero.plan).toEqual([]);
    expect(canEnter(level, hero.pos + dir[0]! + dir[1]! * WIDTH) && !charAt(world, 1, hero.pos + dir[0]! + dir[1]! * WIDTH)).toBe(false);
  });

  it('plays alike from the same orders', () => {
    const run = (): string => {
      const world = live(2);
      const hero = heroById(world, 'p0')!;
      act(world, 'p0', { type: 'plan', steps: [{ type: 'go', to: farCell(world, hero.pos, 6) }] });
      for (let i = 0; i < 30; i++) liveTick(world, 1);
      return JSON.stringify(world);
    };
    expect(run()).toBe(run());
  });

  it('is refused in a world of classic turns', () => {
    const world = pacify(createWorld(5));
    addHero(world, { id: 'p', name: 'P', heroClass: 'mage' });
    expect(act(world, 'p', { type: 'plan', steps: [] })).toEqual({ ok: false, reason: 'not a live world' });
  });
});
