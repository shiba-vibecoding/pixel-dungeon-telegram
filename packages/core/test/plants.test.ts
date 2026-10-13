import { describe, expect, it } from 'vitest';
import {
  act, addHero, canEnter, charAt, createItem, createMob, createWorld, floorAt, heroById, levelAt, NEIGHBOURS8, RoomType, T,
  WIDTH, type World,
} from '../src/index';
import { pacify } from './helpers';

function solo(seed = 19): World {
  const world = pacify(createWorld(seed));
  addHero(world, { id: 'p', name: 'P', heroClass: 'warrior' });
  heroById(world, 'p')!.items = [];
  return world;
}

/** Throws a seed onto the cell next to the hero, then steps onto the plant. */
function plantAndStep(world: World, seed: 'seed.sungrass' | 'seed.earthroot' | 'seed.sorrowmoss' | 'seed.fadeleaf' | 'seed.icecap' | 'seed.dreamweed') {
  const hero = heroById(world, 'p')!;
  const level = levelAt(world, 1);
  const cell = NEIGHBOURS8.map((n) => hero.pos + n).find((c) => canEnter(level, c) && !charAt(world, 1, c))!;
  hero.items = [createItem(seed)];
  const thrown = act(world, 'p', { type: 'throw', item: 0, target: cell });
  expect(thrown.ok && thrown.effects.some((e) => e.type === 'planted' && e.pos === cell)).toBe(true);
  const stepped = act(world, 'p', { type: 'move', to: cell });
  return { cell, effects: stepped.ok ? stepped.effects : [] };
}

describe('seeds and plants', () => {
  it('a thrown seed takes root; stepping on the plant sets it off and uses it up', () => {
    const world = solo();
    const hero = heroById(world, 'p')!;
    hero.hp = 5;
    const { cell, effects } = plantAndStep(world, 'seed.sungrass');
    expect(effects.some((e) => e.type === 'plantTriggered' && e.kind === 'sungrass')).toBe(true);
    expect(floorAt(world, 1).plants?.some((p) => p.pos === cell)).toBe(false);
    // Sungrass heals while one stays on the spot.
    for (let i = 0; i < 10; i++) act(world, 'p', { type: 'wait' });
    expect(hero.hp).toBeGreaterThan(5);
  });

  it('earthroot hardens the skin of whoever stands still on it', () => {
    const world = solo();
    const hero = heroById(world, 'p')!;
    Object.assign(hero, { defenseSkill: 0 });
    plantAndStep(world, 'seed.earthroot');
    expect(hero.earthroot?.level).toBe(hero.ht);
    const level = levelAt(world, 1);
    const pos = NEIGHBOURS8.map((n) => hero.pos + n).find((c) => canEnter(level, c) && !charAt(world, 1, c))!;
    const rat = createMob('#rat', 'rat', pos, 'hunting', floorAt(world, 1).now);
    Object.assign(rat, { enemy: 'p', target: hero.pos, enemySeen: true });
    floorAt(world, 1).mobs.push(rat);
    const before = hero.hp;
    for (let i = 0; i < 4; i++) act(world, 'p', { type: 'wait' });
    expect(hero.hp).toBeGreaterThanOrEqual(before);
  });

  it('sorrowmoss poisons, fadeleaf carries off, icecap freezes, dreamweed confuses', () => {
    let world = solo();
    plantAndStep(world, 'seed.sorrowmoss');
    expect(heroById(world, 'p')!.poison).toBeGreaterThan(0);

    world = solo();
    const { cell } = plantAndStep(world, 'seed.fadeleaf');
    expect(heroById(world, 'p')!.pos).not.toBe(cell);

    // Frozen, the hero's turns pass by at once.
    world = solo();
    const frozen = heroById(world, 'p')!;
    const before = frozen.time;
    plantAndStep(world, 'seed.icecap');
    expect(frozen.time - before).toBeGreaterThanOrEqual(5);

    world = solo();
    plantAndStep(world, 'seed.dreamweed');
    expect(heroById(world, 'p')!.dizzy).toBeGreaterThan(0);
  });

  it('gardens grow sungrass now and then (GardenRoom: one time in three, or both bushes now and then)', () => {
    let gardens = 0;
    let sungrass = 0;
    for (let seed = 1; seed <= 80 && gardens < 12; seed++) {
      const world = createWorld(seed * 13);
      for (let depth = 1; depth <= 4; depth++) {
        const level = levelAt(world, depth);
        const garden = level.rooms.find((r) => r.type === RoomType.GARDEN);
        if (!garden) continue;
        gardens++;
        const inside = (pos: number): boolean => pos % WIDTH > garden.left && pos % WIDTH < garden.right && Math.trunc(pos / WIDTH) > garden.top && Math.trunc(pos / WIDTH) < garden.bottom;
        if (floorAt(world, depth).plants?.some((p) => p.kind === 'sungrass' && inside(p.pos))) sungrass++;
      }
    }
    expect(gardens).toBeGreaterThan(0);
    expect(sungrass).toBeGreaterThan(0);
  });
});
