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
      // CavesBossLevel: the way down beyond the gate, wires strewn about the arena (bosses.test.ts has more).
      const lair = levels[14]!;
      expect(lair.map[lair.exit]).toBe(T.EXIT);
      expect(lair.map[lair.entrance]).toBe(T.ENTRANCE);
      expect(lair.map.filter((t) => t === T.INACTIVE_TRAP).length).toBeGreaterThan(10);
    }
  });

  it('see as far as anywhere (the caves are not dark in Shattered): nobody sees more than eight cells there', () => {
    const world = at(12);
    const hero = heroById(world, 'p')!;
    const level = levelAt(world, 12);
    const far = heroView(world, hero).some((seen, cell) => seen && Math.max(
      Math.abs((cell % WIDTH) - (hero.pos % WIDTH)), Math.abs(Math.trunc(cell / WIDTH) - Math.trunc(hero.pos / WIDTH)),
    ) > 8);
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

