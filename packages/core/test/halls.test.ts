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
  it('generate depths 21-26: the last shop, Yog-Dzewa, and the Amulet', () => {
    for (let seed = 1; seed <= 15; seed++) {
      const run = createRun(seed);
      // The imp's errand done: the last shop is open (see last-shop.test.ts).
      const levels = Array.from({ length: 26 }, (_, i) => generateLevel(run, i + 1, undefined, true));
      // HallsBossLevel: the way down is carved wall until Yog falls; LastLevel: the Amulet, at the end of the walk.
      for (const level of levels.slice(20, 24)) {
        expect(level.map[level.entrance], `seed ${seed} depth ${level.depth}`).toBe(T.ENTRANCE);
        expect(level.map[level.exit], `seed ${seed} depth ${level.depth}`).toBe(T.EXIT);
      }
      expect(levels[20]!.rooms.some((r) => r.type === RoomType.SHOP)).toBe(true);
      expect(levels[24]!.map[levels[24]!.exit]).toBe(T.WALL_DECO);
      const last = levels[25]!;
      expect(last.items.some((s) => s.item.roll === 'kind' && s.item.kind === 'quest.amulet')).toBe(true);
      expect(last.map[last.items[0]!.pos]).toBe(T.EMPTY);
    }
  });

  it('are dark, darker the deeper; a torch lights the way', () => {
    const world = at(24);
    const hero = heroById(world, 'p')!;
    const dark = seenCells(world);
    expect(dark).toBeLessThanOrEqual(9);
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
        for (let i = 0; i < 10; i++) {
          const result = act(world, 'p', { type: 'search' });
          if (result.ok) effects.push(...result.effects);
        }
        // Eye.doAttack: it charges its beam first, then lets the deathgaze go.
        const gazes = effects.filter((e) => e.type === 'mobZap' && e.bolt === 'deathGaze');
        if (gazes.length > 0) expect(effects.some((e) => e.type === 'charging' && e.mob === '#eye')).toBe(true);
        if (gazes.length === 0) continue;
        expect(effects.some((e) => e.type === 'attack' && e.attacker === '#eye' && e.target === '#rat')).toBe(true);
        return;
      }
    }
    throw new Error('the eye never gazed');
  });
});

// Yog-Dzewa's fight and the Amulet: bosses.test.ts.
describe('the demon halls, played through', () => {
  it('a simple bot can play through the halls without breaking anything', { timeout: 60000 }, () => {
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
