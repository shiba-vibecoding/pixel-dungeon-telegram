import { describe, expect, it } from 'vitest';
import {
  act, type Action, addHero, adjacent, canEnter, castShadow, charAt, createMob, createRun, createWorld, type Effect,
  findPath, floorAt, generateLevel, heroById, heroView, isAlive, levelAt, NEIGHBOURS8, RoomType, T, terrainBlocksSight,
  type World,
  WIDTH,
} from '../src/index';
import { botAction, checkInvariants, pacify, skeletonKey } from './helpers';

function at(depth: number, seed = 3): World {
  const world = createWorld(seed);
  for (let d = 1; d <= depth; d++) levelAt(world, d);
  pacify(world);
  floorAt(world, depth).mobs = floorAt(world, depth).mobs.filter((m) => m.state === 'passive');
  floorAt(world, depth).respawn = 1e9;
  addHero(world, { id: 'p', name: 'P', heroClass: 'warrior' });
  const hero = heroById(world, 'p')!;
  hero.depth = depth;
  hero.pos = levelAt(world, depth).entrance;
  hero.time = floorAt(world, depth).now;
  return world;
}

describe('the caves', () => {
  it('generate depths 11-15, with a second shop on depth 11', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const run = createRun(seed);
      const levels = Array.from({ length: 15 }, (_, i) => generateLevel(run, i + 1));
      for (const level of levels.slice(10, 14)) {
        expect(level.map[level.entrance], `seed ${seed} depth ${level.depth}`).toBeOneOf([T.ENTRANCE, T.ENTRANCE_SP]);
        expect(level.map[level.exit], `seed ${seed} depth ${level.depth}`).toBe(T.EXIT);
      }
      expect(levels[10]!.rooms.some((r) => r.type === RoomType.SHOP)).toBe(true);
      const lair = levels[14]!;
      expect(lair.map[lair.exit]).toBe(T.LOCKED_EXIT);
      expect(lair.map[lair.arenaDoor!]).toBe(T.DOOR);
      expect(lair.map[lair.entrance]).toBe(T.ENTRANCE);
      expect(lair.map.filter((t) => t === T.INACTIVE_TRAP).length).toBeGreaterThan(10);
    }
  });

  it('are dark: nobody sees more than six cells there', () => {
    const world = at(12);
    const hero = heroById(world, 'p')!;
    const level = levelAt(world, 12);
    const far = heroView(world, hero).some((seen, cell) => seen && Math.max(
      Math.abs((cell % WIDTH) - (hero.pos % WIDTH)), Math.abs(Math.trunc(cell / WIDTH) - Math.trunc(hero.pos / WIDTH)),
    ) > 6);
    expect(far).toBe(false);
    expect(castShadow(hero.pos, terrainBlocksSight(level.map)).filter(Boolean).length)
      .toBeGreaterThanOrEqual(heroView(world, hero).filter(Boolean).length);
  });

  it('a cave spinner\'s bite may poison, and then it backs off', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const world = at(13, seed);
      const hero = heroById(world, 'p')!;
      Object.assign(hero, { ht: 500, hp: 500, defenseSkill: 0 });
      const level = levelAt(world, 13);
      const pos = NEIGHBOURS8.map((n) => hero.pos + n).find((c) => canEnter(level, c) && !charAt(world, 13, c))!;
      const spinner = createMob('#spinner', 'spinner', pos, 'hunting', floorAt(world, 13).now);
      Object.assign(spinner, { enemy: 'p', target: hero.pos, enemySeen: true });
      floorAt(world, 13).mobs.push(spinner);
      let fled = false;
      for (let i = 0; i < 20 && !fled; i++) {
        act(world, 'p', { type: 'wait' });
        fled = spinner.state === 'fleeing' || hero.poison > 0;
      }
      if (!fled) continue;
      expect(hero.poison).toBeGreaterThan(0);
      return;
    }
    throw new Error('the spinner never bit');
  });
});

describe("DM-300's caves", () => {
  it('DM-300 starts up when someone steps into the cave, and the door closes behind', () => {
    const world = at(15);
    const hero = heroById(world, 'p')!;
    Object.assign(hero, { ht: 500, hp: 500 });
    const level = levelAt(world, 15);
    const door = level.arenaDoor!;
    // Walk through the door and out into the cave.
    for (let i = 0; i < 40 && !floorAt(world, 15).arenaEntered; i++) {
      const path = findPath(level, hero.pos, door + WIDTH);
      if (!path || path.length === 0) break;
      act(world, 'p', { type: 'move', to: path[0]! });
    }
    expect(floorAt(world, 15).arenaEntered).toBe(true);
    expect(floorAt(world, 15).mobs.some((m) => m.kind === 'dm300')).toBe(true);
    expect(level.map[door]).toBe(T.WALL);
  });

  it('it leaks gas, repairs itself on spent traps, and its fall opens the way down to the city', () => {
    let won = 0;
    for (const seed of [2, 3]) {
      const world = at(15, seed);
      const hero = heroById(world, 'p')!;
      Object.assign(hero, { attackSkill: 300, defenseSkill: 50, ht: 8000, hp: 8000, str: 18 });
      hero.weapon = { kind: 'weapon.glaive', qty: 1, level: 5 };
      const level = levelAt(world, 15);
      const effects: Effect[] = [];
      let leaked = false;
      const step = (): Action => {
        const dm = floorAt(world, 15).mobs.find((m) => m.kind === 'dm300');
        if (dm && adjacent(dm.pos, hero.pos)) return { type: 'attack', target: dm.id };
        const key = dm ? null : skeletonKey(world, 'p');
        if (key) return key;
        if (hero.pos === level.exit) return { type: 'descend' };
        const goal = dm ? dm.pos : floorAt(world, 15).arenaEntered ? level.exit : level.arenaDoor! + WIDTH;
        const others = new Set(floorAt(world, 15).mobs.map((m) => m.pos));
        others.delete(goal);
        const path = findPath(level, hero.pos, goal, others);
        return path && path.length > 0 ? { type: 'move', to: path[0]! } : { type: 'wait' };
      };
      for (let i = 0; i < 4000 && !world.over && hero.depth === 15; i++) {
        let result = act(world, 'p', step());
        if (!result.ok) result = act(world, 'p', { type: 'wait' });
        if (result.ok) effects.push(...result.effects);
        if (floorAt(world, 15).gas?.toxic?.length) leaked = true;
        checkInvariants(world);
      }
      expect(leaked, `seed ${seed}`).toBe(true);
      expect(effects.some((e) => e.type === 'bossSlain' && e.kind === 'dm300'), `seed ${seed}`).toBe(true);
      expect(level.map[level.arenaDoor!], `seed ${seed}`).toBe(T.EMPTY_DECO);
      expect(hero.depth, `seed ${seed}`).toBe(16);
      expect(world.over, `seed ${seed}`).toBe(false);
      won++;
    }
    expect(won).toBe(2);
  });

  it('a simple bot can play through the caves without breaking anything', () => {
    for (const seed of [21, 22]) {
      const world = at(11, seed);
      const hero = heroById(world, 'p')!;
      Object.assign(hero, { attackSkill: 300, defenseSkill: 60, ht: 6000, hp: 6000 });
      for (let i = 0; i < 6000 && isAlive(hero) && hero.depth < 15; i++) {
        const result = act(world, 'p', botAction(world, 'p', 15));
        if (!result.ok) act(world, 'p', { type: 'wait' });
        checkInvariants(world);
      }
      expect(hero.depth, `seed ${seed}`).toBe(15);
    }
  });
});
