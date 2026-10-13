import { describe, expect, it } from 'vitest';
import { act, addHero, canEnter, charAt, createMob, createWorld, findPath, floorAt, heroById, levelAt, NEIGHBOURS8, type World } from '../src/index';
import { pacify } from './helpers';

function twoHeroes(seed = 2026): World {
  const world = createWorld(seed);
  addHero(world, { id: 'a', name: 'Alice', heroClass: 'warrior' });
  addHero(world, { id: 'b', name: 'Bob', heroClass: 'mage' });
  // After both have joined: a second hero brings the depths more monsters (party.ts).
  return pacify(world);
}

/** Walks a hero along a path to `to`, one validated step per turn. */
function walk(world: World, id: string, to: number): void {
  const hero = heroById(world, id)!;
  const others = new Set(world.heroes.filter((h) => h !== hero && h.depth === hero.depth).map((h) => h.pos));
  const path = findPath(levelAt(world, hero.depth), hero.pos, to, others);
  expect(path, `path to ${to}`).not.toBeNull();
  for (const step of path!) {
    expect(act(world, id, { type: 'move', to: step }).ok).toBe(true);
    expect(hero.pos).toBe(step);
  }
}

describe('shared world', () => {
  it('places joining heroes on distinct cells at the entrance', () => {
    const world = twoHeroes();
    const [a, b] = world.heroes;
    expect(a!.depth).toBe(1);
    expect(b!.depth).toBe(1);
    expect(a!.pos).not.toBe(b!.pos);
  });

  it('rejects moves that are not one step onto free walkable ground', () => {
    const world = twoHeroes();
    const [a, b] = world.heroes;
    expect(act(world, 'a', { type: 'move', to: a!.pos + 5 }).ok).toBe(false);
    expect(act(world, 'a', { type: 'move', to: 0 }).ok).toBe(false);
    // A companion next to the hero is no obstacle: they swap places (see the co-op tests).
    const bob = b!.pos;
    if (Math.abs(a!.pos - bob) <= 33) {
      b!.rooted = 3;
      expect(act(world, 'a', { type: 'move', to: bob })).toEqual({ ok: false, reason: 'cell is occupied' });
    }
    expect(act(world, 'nobody', { type: 'wait' }).ok).toBe(false);
  });

  it('lets each hero walk to the stairs and descend independently', () => {
    const world = twoHeroes();
    const exit = levelAt(world, 1).exit;
    expect(act(world, 'a', { type: 'descend' }).ok).toBe(false);
    walk(world, 'a', exit);
    expect(act(world, 'a', { type: 'descend' }).ok).toBe(true);
    const a = heroById(world, 'a')!;
    expect(a.depth).toBe(2);
    expect(heroById(world, 'b')!.depth).toBe(1);
    // Bob follows down the same stairs into the same level.
    walk(world, 'b', exit);
    expect(act(world, 'b', { type: 'descend' }).ok).toBe(true);
    const b = heroById(world, 'b')!;
    expect(b.depth).toBe(2);
    expect(b.pos).not.toBe(a.pos);
    // Alice arrived first and still stands on the stairs up; they lead to
    // the exit of the level above.
    expect(a.pos).toBe(levelAt(world, 2).entrance);
    expect(act(world, 'a', { type: 'ascend' }).ok).toBe(true);
    expect(a.depth).toBe(1);
    expect(a.pos).toBe(exit);
  });

  it('serialises: a JSON copy of the world continues identically', () => {
    const world = twoHeroes(77);
    const copy: World = JSON.parse(JSON.stringify(world));
    walk(world, 'a', levelAt(world, 1).exit);
    walk(copy, 'a', levelAt(copy, 1).exit);
    expect(act(world, 'a', { type: 'descend' })).toEqual(act(copy, 'a', { type: 'descend' }));
    expect(copy).toEqual(world);
  });
});

describe('harmless wanderers', () => {
  it('a hero swaps places with the sad ghost or a sheep instead of being stopped', () => {
    const world = pacify(createWorld(77));
    addHero(world, { id: 'a', name: 'Alice', heroClass: 'warrior' });
    const hero = heroById(world, 'a')!;
    const level = levelAt(world, 1);
    const floor = floorAt(world, 1);
    const next = NEIGHBOURS8.map((n) => hero.pos + n).find((c) => canEnter(level, c) && !charAt(world, 1, c))!;
    for (const kind of ['ghost', 'sheep'] as const) {
      const from = hero.pos;
      const there = from === next ? NEIGHBOURS8.map((n) => from + n).find((c) => canEnter(level, c))! : next;
      const wanderer = createMob(`#${kind}`, kind, there, 'passive', floor.now);
      floor.mobs.push(wanderer);
      expect(act(world, 'a', { type: 'move', to: there }).ok, kind).toBe(true);
      expect(hero.pos, kind).toBe(there);
      expect(wanderer.pos, kind).toBe(from);
      floor.mobs = floor.mobs.filter((m) => m !== wanderer);
    }
    // Monsters still stand their ground.
    const rat = createMob('#rat', 'rat', next === hero.pos ? NEIGHBOURS8.map((n) => hero.pos + n).find((c) => canEnter(level, c))! : next, 'sleeping', floor.now);
    floor.mobs.push(rat);
    expect(act(world, 'a', { type: 'move', to: rat.pos })).toEqual({ ok: false, reason: 'cell is occupied' });
  });
});
