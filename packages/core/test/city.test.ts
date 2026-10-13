import { describe, expect, it } from 'vitest';
import {
  act, type Action, addHero, adjacent, canEnter, charAt, createItem, createMob, createRun, createWorld, type Effect,
  findPath, floorAt, generateLevel, heroById, heroStr, isAlive, levelAt, NEIGHBOURS8, RoomType, T, type World,
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

describe('the dwarven city', () => {
  it('generates depths 16-20, with a third shop on depth 16', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const run = createRun(seed);
      const levels = Array.from({ length: 20 }, (_, i) => generateLevel(run, i + 1));
      for (const level of levels.slice(15, 19)) {
        expect(level.map[level.entrance], `seed ${seed} depth ${level.depth}`).toBe(T.ENTRANCE);
        expect(level.map[level.exit], `seed ${seed} depth ${level.depth}`).toBe(T.EXIT);
      }
      expect(levels[15]!.rooms.some((r) => r.type === RoomType.SHOP)).toBe(true);
      const hall = levels[19]!;
      expect(hall.map[hall.exit]).toBe(T.LOCKED_EXIT);
      expect(hall.map[hall.arenaDoor!]).toBe(T.DOOR);
      expect(hall.map.filter((t) => t === T.PEDESTAL)).toHaveLength(2);
    }
  });

  it("a warlock's dark bolt may degrade the hero's gear for thirty turns", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const world = at(17, seed);
      const hero = heroById(world, 'p')!;
      Object.assign(hero, { ht: 1000, hp: 1000, defenseSkill: 0 });
      const level = levelAt(world, 17);
      const far = [2, 3].flatMap((k) => NEIGHBOURS8.map((n) => hero.pos + n * k)).find(
        (c) => canEnter(level, c) && level.map[c] !== T.DOOR && !charAt(world, 17, c) && canEnter(level, (c + hero.pos) / 2),
      );
      if (far === undefined || !Number.isInteger((far + hero.pos) / 2)) continue;
      const warlock = createMob('#warlock', 'warlock', far, 'hunting', floorAt(world, 17).now);
      Object.assign(warlock, { enemy: 'p', target: hero.pos, enemySeen: true });
      floorAt(world, 17).mobs.push(warlock);
      const effects: Effect[] = [];
      for (let i = 0; i < 20 && !(hero.degraded ?? 0); i++) {
        const result = act(world, 'p', { type: 'search' });
        if (result.ok) effects.push(...result.effects);
      }
      if (!(hero.degraded ?? 0)) continue;
      // Warlock.zap: a bolt from afar (a dark one), and Degrade for thirty turns, which wears off.
      expect(effects.some((e) => e.type === 'mobZap' && e.mob === '#warlock' && e.bolt === 'shadow')).toBe(true);
      expect(effects.some((e) => e.type === 'afflicted' && e.by === 'degrade')).toBe(true);
      expect(hero.degraded).toBeLessThanOrEqual(30);
      expect(heroStr(hero)).toBe(hero.str);
      floorAt(world, 17).mobs = [];
      for (let i = 0; i < 31; i++) act(world, 'p', { type: 'wait' });
      expect(hero.degraded).toBe(0);
      return;
    }
    throw new Error('the warlock never degraded anyone');
  });

  it('a fire elemental feeds on fire and sets its foes alight', () => {
    const world = at(16);
    const hero = heroById(world, 'p')!;
    Object.assign(hero, { ht: 1000, hp: 1000, defenseSkill: 0 });
    const level = levelAt(world, 16);
    const pos = NEIGHBOURS8.map((n) => hero.pos + n).find((c) => canEnter(level, c) && !charAt(world, 16, c) && level.map[c] !== T.WATER)!;
    const elemental = createMob('#el', 'elemental', pos, 'hunting', floorAt(world, 16).now);
    Object.assign(elemental, { enemy: 'p', target: hero.pos, enemySeen: true, hp: 30, burning: 5 });
    floorAt(world, 16).mobs.push(elemental);
    let burnt = false;
    for (let i = 0; i < 20 && !burnt; i++) {
      act(world, 'p', { type: 'wait' });
      burnt = hero.burning > 0;
    }
    expect(elemental.hp).toBeGreaterThanOrEqual(30);
    expect(burnt).toBe(true);
  });
});

describe("the King of Dwarves' hall", () => {
  it('the King appears, raises undead from his pedestals, and his fall opens the way down', () => {
    let won = 0;
    for (const seed of [2, 3]) {
      const world = at(20, seed);
      const hero = heroById(world, 'p')!;
      Object.assign(hero, { attackSkill: 400, defenseSkill: 60, ht: 20000, hp: 20000, str: 20 });
      hero.weapon = createItem('weapon.warHammer', 1, 6);
      const level = levelAt(world, 20);
      const effects: Effect[] = [];
      const step = (): Action => {
        const floor = floorAt(world, 20);
        const king = floor.mobs.find((m) => m.kind === 'king');
        const foe = floor.mobs.find((m) => adjacent(m.pos, hero.pos));
        if (foe) return { type: 'attack', target: foe.id };
        const key = king ? null : skeletonKey(world, 'p');
        if (key) return key;
        if (hero.pos === level.exit) return { type: 'descend' };
        const goal = king ? king.pos : floor.arenaEntered ? level.exit : level.arenaDoor! - WIDTH;
        const others = new Set(floor.mobs.map((m) => m.pos));
        others.delete(goal);
        const path = findPath(level, hero.pos, goal, others);
        return path && path.length > 0 ? { type: 'move', to: path[0]! } : { type: 'wait' };
      };
      for (let i = 0; i < 6000 && !world.over && hero.depth === 20; i++) {
        let result = act(world, 'p', step());
        if (!result.ok) result = act(world, 'p', { type: 'wait' });
        if (result.ok) effects.push(...result.effects);
        checkInvariants(world);
      }
      expect(effects.some((e) => e.type === 'yell' && e.kind === 'king' && e.line === 'summon'), `seed ${seed}`).toBe(true);
      expect(effects.some((e) => e.type === 'bossSlain' && e.kind === 'king'), `seed ${seed}`).toBe(true);
      expect(effects.some((e) => e.type === 'arena' && e.sealed), `seed ${seed}`).toBe(true);
      expect(hero.depth === 21 || world.victory, `seed ${seed}`).toBe(true);
      won++;
    }
    expect(won).toBe(2);
  });

  it('a simple bot can play through the city without breaking anything', () => {
    for (const seed of [31, 32]) {
      const world = at(16, seed);
      const hero = heroById(world, 'p')!;
      // Strong enough to fight on bare-handed once a monk disarms it, before Shattered's hunger starves it.
      Object.assign(hero, { attackSkill: 400, defenseSkill: 80, ht: 20000, hp: 20000, str: 25 });
      for (let i = 0; i < 6000 && isAlive(hero) && hero.depth < 20; i++) {
        const result = act(world, 'p', botAction(world, 'p', 20));
        if (!result.ok) act(world, 'p', { type: 'wait' });
        checkInvariants(world);
      }
      expect(hero.depth, `seed ${seed}`).toBe(20);
    }
  });
});
