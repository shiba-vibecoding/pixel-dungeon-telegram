import { describe, expect, it } from 'vitest';
import {
  act, type Action, addHero, adjacent, canEnter, charAt, createItem, createMob, createRun, createWorld, type Effect,
  findPath, floorAt, generateLevel, heroById, heroView, isAlive, levelAt, NEIGHBOURS8, RoomType, T, type World,
} from '../src/index';
import { botAction, checkInvariants, pacify } from './helpers';

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

const seenCells = (world: World): number => heroView(world, heroById(world, 'p')!).filter(Boolean).length;

describe('the demon halls', () => {
  it("generate depths 21-26: Yog-Dzewa and the Amulet (the imp keeps his shop in the King's hall now)", () => {
    for (let seed = 1; seed <= 8; seed++) {
      const run = createRun(seed);
      const levels = Array.from({ length: 26 }, (_, i) => generateLevel(run, i + 1, undefined, true));
      for (const level of levels.slice(20, 24)) {
        expect(level.map[level.entrance], `seed ${seed} depth ${level.depth}`).toBeOneOf([T.ENTRANCE, T.ENTRANCE_SP]);
        expect(level.map[level.exit], `seed ${seed} depth ${level.depth}`).toBe(T.EXIT);
      }
      expect(levels[24]!.map[levels[24]!.exit]).toBe(T.LOCKED_EXIT);
      const last = levels[25]!;
      expect(last.items.some((s) => s.item.roll === 'kind' && s.item.kind === 'quest.amulet')).toBe(true);
      expect(last.map[last.items[0]!.pos]).toBe(T.PEDESTAL);
    }
  });

  it('are dark, darker the deeper; a torch lights the way', () => {
    const world = at(24);
    const hero = heroById(world, 'p')!;
    const dark = seenCells(world);
    // HallsLevel: sight is 26 - depth, two cells here.
    expect(dark).toBeLessThanOrEqual(25);
    hero.items = [createItem('torch')];
    const result = act(world, 'p', { type: 'use', item: 0 });
    expect(result.ok && result.effects.some((e) => e.type === 'lit')).toBe(true);
    expect(hero.light).toBeGreaterThan(200);
    expect(seenCells(world)).toBeGreaterThan(dark);
  });

  it("a charmed hero cannot strike the succubus who charmed them", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const world = at(22, seed);
      const hero = heroById(world, 'p')!;
      Object.assign(hero, { ht: 2000, hp: 2000, defenseSkill: 0 });
      const level = levelAt(world, 22);
      const pos = NEIGHBOURS8.map((n) => hero.pos + n).find((c) => canEnter(level, c) && !charAt(world, 22, c))!;
      const succubus = createMob('#suc', 'succubus', pos, 'hunting', floorAt(world, 22).now);
      Object.assign(succubus, { enemy: 'p', target: hero.pos, enemySeen: true });
      floorAt(world, 22).mobs.push(succubus);
      for (let i = 0; i < 20 && hero.charmed <= 0; i++) act(world, 'p', { type: 'wait' });
      if (hero.charmed <= 0 || !adjacent(succubus.pos, hero.pos)) continue;
      expect(act(world, 'p', { type: 'attack', target: succubus.id })).toEqual({ ok: false, reason: 'you are charmed' });
      return;
    }
    throw new Error('never charmed');
  });

  it("the evil eye's gaze strikes everyone in its line", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const world = at(23, seed);
      const hero = heroById(world, 'p')!;
      Object.assign(hero, { ht: 2000, hp: 2000, defenseSkill: 0, light: 500 });
      const level = levelAt(world, 23);
      for (const dir of [1, -1, 32, -32]) {
        const line = [1, 2, 3].map((k) => hero.pos + dir * k);
        if (!line.every((c) => canEnter(level, c) && level.map[c] !== T.DOOR && !charAt(world, 23, c))) continue;
        const eye = createMob('#eye', 'eye', line[2]!, 'hunting', floorAt(world, 23).now);
        const between = createMob('#rat', 'larva', line[1]!, 'sleeping', floorAt(world, 23).now);
        Object.assign(eye, { enemy: 'p', target: hero.pos, enemySeen: true });
        floorAt(world, 23).mobs.push(eye, between);
        const effects: Effect[] = [];
        for (let i = 0; i < 6; i++) {
          const result = act(world, 'p', { type: 'search' });
          if (result.ok) effects.push(...result.effects);
        }
        const gazes = effects.filter((e) => e.type === 'zapped' && e.bolt === 'beam');
        if (gazes.length === 0) continue;
        expect(effects.some((e) => e.type === 'attack' && e.attacker === '#eye' && e.target === '#rat')).toBe(true);
        return;
      }
    }
    throw new Error('the eye never gazed');
  });
});

describe("Yog-Dzewa and the Amulet", () => {
  it('the first step breaks the stairs room; Yog and its fists fall; the Amulet ends the run', () => {
    let won = 0;
    for (const seed of [2, 5]) {
      const world = at(25, seed);
      const hero = heroById(world, 'p')!;
      Object.assign(hero, { attackSkill: 600, defenseSkill: 80, ht: 50000, hp: 50000, str: 22, light: 100000 });
      hero.weapon = createItem('weapon.warHammer', 1, 10);
      const level = levelAt(world, 25);
      const stairs = level.entrance;
      const effects: Effect[] = [];
      const step = (): Action => {
        const floor = floorAt(world, hero.depth);
        const lvl = levelAt(world, hero.depth);
        if (hero.depth === 26) {
          if (hero.items.some((i) => i.kind === 'quest.amulet')) return { type: 'endGame' };
          const amulet = floor.heaps.find((h) => h.items.some((i) => i.kind === 'quest.amulet'))!;
          if (hero.pos === amulet.pos) return { type: 'pickup' };
          const path = findPath(lvl, hero.pos, amulet.pos);
          return path && path.length > 0 ? { type: 'move', to: path[0]! } : { type: 'wait' };
        }
        const foe = floor.mobs.find((m) => adjacent(m.pos, hero.pos) && m.kind !== 'yog') ?? floor.mobs.find((m) => adjacent(m.pos, hero.pos));
        if (foe) return { type: 'attack', target: foe.id };
        if (hero.pos === lvl.exit) return { type: 'descend' };
        const fist = floor.mobs.find((m) => m.kind === 'rottingFist' || m.kind === 'burningFist');
        const yog = floor.mobs.find((m) => m.kind === 'yog');
        const goal = fist?.pos ?? yog?.pos ?? (floor.arenaEntered ? lvl.exit : NEIGHBOURS8.map((n) => hero.pos + n).find((c) => canEnter(lvl, c))!);
        const others = new Set(floor.mobs.map((m) => m.pos));
        others.delete(goal);
        const path = findPath(lvl, hero.pos, goal, others);
        return path && path.length > 0 ? { type: 'move', to: path[0]! } : { type: 'wait' };
      };
      for (let i = 0; i < 8000 && !world.over; i++) {
        let result = act(world, 'p', step());
        if (!result.ok) result = act(world, 'p', { type: 'wait' });
        if (result.ok) effects.push(...result.effects);
        checkInvariants(world);
      }
      expect(level.map[stairs], `seed ${seed}`).toBe(T.EMPTY_SP);
      expect(effects.some((e) => e.type === 'yell' && e.kind === 'yog'), `seed ${seed}`).toBe(true);
      expect(effects.some((e) => e.type === 'bossSlain' && e.kind === 'yog'), `seed ${seed}`).toBe(true);
      expect(world, `seed ${seed}`).toMatchObject({ over: true, victory: true });
      expect(hero.items.some((i) => i.kind === 'quest.amulet'), `seed ${seed}`).toBe(true);
      won++;
    }
    expect(won).toBe(2);
  });

  it('a simple bot can play through the halls without breaking anything', () => {
    for (const seed of [41, 42]) {
      const world = at(21, seed);
      const hero = heroById(world, 'p')!;
      // Demons sting and gaze from afar, and this simple bot would rest forever: it is kept healthy.
      Object.assign(hero, { attackSkill: 600, defenseSkill: 100, ht: 50000, hp: 50000, light: 100000 });
      for (let i = 0; i < 8000 && isAlive(hero) && hero.depth < 25; i++) {
        hero.hp = hero.ht;
        const result = act(world, 'p', botAction(world, 'p', 25));
        if (!result.ok) act(world, 'p', { type: 'wait' });
        checkInvariants(world);
      }
      expect(hero.depth, `seed ${seed}`).toBe(25);
    }
  });
});
