import { describe, expect, it } from 'vitest';
import {
  act, type Action, addHero, adjacent, createWorld, type Effect, F, findPath, floorAt, hasFlag, heroById, isAlive,
  levelAt, LENGTH, NEIGHBOURS8, RoomType, T, trapAt, WIDTH, type World,
} from '../src/index';
import { checkInvariants, pacify, skeletonKey } from './helpers';

/** Cells reachable from `from`, treating hidden doors as open. */
function reachable(world: World, depth: number, from: number): Set<number> {
  const map = levelAt(world, depth).map;
  const open = (cell: number): boolean => hasFlag(map[cell]!, F.PASSABLE) || map[cell] === T.SECRET_DOOR || hasFlag(map[cell]!, F.AVOID);
  const seen = new Set([from]);
  const queue = [from];
  for (let head = 0; head < queue.length; head++) {
    for (const n of NEIGHBOURS8) {
      const next = queue[head]! + n;
      if (next >= 0 && next < LENGTH && !seen.has(next) && open(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

/**
 * A hero at the entrance of Goo's lair, as strong as a well-equipped one
 * (the test is about the rules, not the balance).
 */
function atTheLair(seed: number): World {
  const world = pacify(createWorld(seed));
  addHero(world, { id: 'p', name: 'P', heroClass: 'warrior' });
  const hero = heroById(world, 'p')!;
  const level = levelAt(world, 5);
  Object.assign(hero, { depth: 5, pos: level.entrance, lvl: 14, ht: 120, hp: 120, attackSkill: 25, defenseSkill: 20 });
  // Hidden doors and traps are no part of this test: open and disarm them all.
  for (let i = 0; i < LENGTH; i++) {
    if (level.map[i] === T.SECRET_DOOR) level.map[i] = T.DOOR;
    const trap = trapAt(level, i);
    if (trap) {
      trap.active = false;
      level.map[i] = T.INACTIVE_TRAP;
    }
  }
  return world;
}

describe("Goo's lair", () => {
  it('is generated with an arena, a locked exit in its top wall and Goo inside', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const world = createWorld(seed);
      const level = levelAt(world, 5);
      const arena = level.rooms.find((r) => r.type === RoomType.BOSS_EXIT)!;
      expect(arena).toBeDefined();
      expect(level.map[level.exit]).toBe(T.LOCKED_EXIT);
      expect(Math.trunc(level.exit / WIDTH)).toBe(arena.top);
      expect(level.map[level.exit + WIDTH]).toBe(T.EMPTY);
      expect(level.map[level.entrance]).toBe(T.ENTRANCE);

      const mobs = floorAt(world, 5).mobs;
      // Goo, and the Rat King in his hidden room next door when there is room for one.
      expect(mobs[0]!.kind).toBe('goo');
      expect(mobs.slice(1).map((m) => m.kind)).toEqual(level.rooms.some((r) => r.type === RoomType.RAT_KING) ? ['ratKing'] : []);
      const goo = mobs[0]!;
      const x = goo.pos % WIDTH;
      const y = Math.trunc(goo.pos / WIDTH);
      expect(x > arena.left && x < arena.right && y > arena.top && y < arena.bottom).toBe(true);
      expect(floorAt(world, 5).respawn).toBe(-1);

      // The arena can be reached from the entrance (perhaps through hidden doors).
      expect(reachable(world, 5, level.entrance).has(level.exit + WIDTH)).toBe(true);
    }
  });

  it('seals the way back while Goo lives; slaying it opens the way down to the prison', () => {
    let won = 0;
    for (const seed of [3, 4, 5, 6]) {
      const world = atTheLair(seed);
      const level = levelAt(world, 5);
      const hero = heroById(world, 'p')!;
      const effects: Effect[] = [];
      const play = (action: Action): void => {
        const result = act(world, 'p', action);
        expect(result.ok, JSON.stringify(result)).toBe(true);
        if (result.ok) effects.push(...result.effects);
        checkInvariants(world);
      };

      for (let i = 0; i < 3000 && isAlive(hero) && !world.over; i++) {
        const goo = floorAt(world, 5).mobs.find((m) => m.kind === 'goo');
        if (goo) {
          if (adjacent(goo.pos, hero.pos)) {
            play({ type: 'attack', target: goo.id });
          } else {
            const path = findPath(level, hero.pos, goo.pos);
            play(path && path.length > 1 ? { type: 'move', to: path[0]! } : { type: 'wait' });
          }
        } else if (skeletonKey(world, 'p')) {
          play(skeletonKey(world, 'p')!);
        } else if (hero.pos === level.exit) {
          play({ type: 'descend' });
          break;
        } else {
          const path = findPath(level, hero.pos, level.exit);
          expect(path).not.toBeNull();
          play({ type: 'move', to: path![0]! });
        }
      }

      const types = new Set(effects.map((e) => e.type));
      expect(types.has('yell')).toBe(true);
      if (isAlive(hero)) {
        expect(types.has('bossSlain')).toBe(true);
        // The way down opened to the skeleton key Goo dropped, not to its fall alone.
        expect(effects.some((e) => e.type === 'pickedUp' && e.item.kind === 'key.skeleton')).toBe(true);
        expect(effects.some((e) => e.type === 'unlocked' && e.pos === level.exit)).toBe(true);
        expect(level.map[level.entrance]).toBe(T.ENTRANCE);
        expect(hero.depth).toBe(6);
        expect(world.over).toBe(false);
        won++;
      } else {
        // Goo won: the lair stays sealed and the run is lost.
        expect(world).toMatchObject({ over: true, victory: false });
      }
      if (types.has('pumped')) expect(effects.some((e) => e.type === 'attack' && e.attacker.startsWith('#'))).toBe(true);
    }
    expect(won).toBeGreaterThan(1);
  });

  it('seals the entrance as soon as Goo moves', () => {
    const world = atTheLair(7);
    const level = levelAt(world, 5);
    const goo = floorAt(world, 5).mobs[0]!;
    goo.state = 'hunting';
    goo.enemy = 'p';
    goo.target = heroById(world, 'p')!.pos;
    for (let i = 0; i < 5; i++) act(world, 'p', { type: 'wait' });
    expect(level.map[level.entrance]).toBe(T.WATER);
    expect(act(world, 'p', { type: 'ascend' }).ok).toBe(false);
  });

  it("washes caustic ooze off in water, and it burns until then", () => {
    const world = pacify(createWorld(8));
    addHero(world, { id: 'p', name: 'P', heroClass: 'warrior' });
    const hero = heroById(world, 'p')!;
    hero.ooze = 0;
    const before = hero.hp;
    const result = act(world, 'p', { type: 'wait' });
    expect(result.ok && result.effects).toContainEqual({ type: 'hurt', depth: 1, who: 'p', damage: 1 });
    expect(hero.hp).toBe(before - 1);

    const level = levelAt(world, 1);
    const water = NEIGHBOURS8.map((n) => hero.pos + n).find((c) => level.map[c] === T.WATER);
    if (water !== undefined) {
      act(world, 'p', { type: 'move', to: water });
      expect(hero.ooze).toBe(-1);
    }
  });
});
