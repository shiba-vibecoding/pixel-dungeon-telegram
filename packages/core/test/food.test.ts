import { describe, expect, it } from 'vitest';
import {
  act, addHero, canEnter, createItem, createWorld, floorAt, heroById, HUNGRY, isStarving, levelAt, NEIGHBOURS8,
  STARVING, T, type World,
} from '../src/index';
import { pacify } from './helpers';

function solo(heroClass: 'warrior' | 'mage' | 'rogue' = 'warrior', seed = 7): World {
  const world = pacify(createWorld(seed));
  addHero(world, { id: 'p', name: 'P', heroClass });
  return world;
}

const waitTurns = (world: World, turns: number): void => {
  for (let i = 0; i < turns; i++) act(world, 'p', { type: 'wait' });
};

describe('hunger', () => {
  it('sets every hero out with a ration', () => {
    const hero = heroById(solo('mage'), 'p')!;
    expect(hero.items.filter((item) => item.kind === 'food.ration')).toHaveLength(1);
  });

  it('grows a step every ten turns, warns when hungry, then starves', () => {
    const world = solo();
    const hero = heroById(world, 'p')!;
    const seen: string[] = [];
    for (let i = 0; i < 400; i++) {
      const result = act(world, 'p', { type: 'wait' });
      if (result.ok) for (const effect of result.effects) if (effect.type === 'hunger') seen.push(`${effect.state}@${i + 1}`);
    }
    expect(seen).toEqual(['hungry@260', 'starving@360']);
    expect(hero.hunger).toBe(STARVING);
  });

  it('lets rogues go a fifth longer', () => {
    const world = solo('rogue');
    const hero = heroById(world, 'p')!;
    waitTurns(world, 120);
    expect(hero.hunger).toBe(100);
  });

  it('stops healing and slowly hurts a starving hero', () => {
    const world = solo();
    const hero = heroById(world, 'p')!;
    hero.hunger = STARVING;
    hero.hp = 10;
    waitTurns(world, 150);
    expect(hero.hp).toBeLessThan(10);
    expect(hero.hp).toBeGreaterThan(0);
  });

  it('starving to death is a cause of its own', () => {
    const world = solo();
    const hero = heroById(world, 'p')!;
    hero.hunger = STARVING;
    hero.hp = 1;
    for (let i = 0; i < 1000 && hero.hp > 0; i++) act(world, 'p', { type: 'wait' });
    expect(hero.hp).toBe(0);
    expect(hero.killedBy).toBe('hunger');
  });
});

describe('eating', () => {
  it('takes three turns and takes the hunger away; warriors also heal', () => {
    const world = solo();
    const hero = heroById(world, 'p')!;
    hero.hunger = 300;
    hero.hp = 10;
    const before = hero.time;
    const result = act(world, 'p', { type: 'use', item: hero.items.findIndex((i) => i.kind === 'food.ration') });
    expect(result.ok && result.effects.find((e) => e.type === 'ate')).toEqual({ type: 'ate', hero: 'p', kind: 'food.ration', outcome: null });
    expect(hero.time - before).toBe(3);
    expect(hero.hunger).toBe(300 - HUNGRY);
    expect(hero.hp).toBe(15);
    expect(hero.items.some((i) => i.kind === 'food.ration')).toBe(false);
  });

  it('recharges the mage\'s wands', () => {
    const world = solo('mage');
    const hero = heroById(world, 'p')!;
    // The wand in the mage's staff.
    const wand = hero.weapon!.wand!;
    wand.charges = 0;
    act(world, 'p', { type: 'use', item: hero.items.findIndex((i) => i.kind === 'food.ration') });
    expect(wand.charges).toBe(1);
  });

  it('a pasty fills a starving hero up completely', () => {
    const world = solo();
    const hero = heroById(world, 'p')!;
    hero.items = [createItem('food.pasty')];
    hero.hunger = STARVING;
    act(world, 'p', { type: 'use', item: 0 });
    expect(isStarving(hero)).toBe(false);
    expect(hero.hunger).toBe(0);
  });

  it('mystery meat often disagrees: rooted heroes cannot walk', () => {
    const outcomes = new Set<string | null>();
    for (let seed = 1; seed <= 40; seed++) {
      const world = solo('warrior', seed);
      const hero = heroById(world, 'p')!;
      hero.items = [createItem('food.meat')];
      const result = act(world, 'p', { type: 'use', item: 0 });
      const ate = result.ok ? result.effects.find((e) => e.type === 'ate') : undefined;
      if (ate?.type !== 'ate') throw new Error('nothing eaten');
      outcomes.add(ate.outcome);
      if (ate.outcome === 'legs') {
        const level = levelAt(world, hero.depth);
        const to = NEIGHBOURS8.map((n) => hero.pos + n).find((c) => canEnter(level, c))!;
        expect(act(world, 'p', { type: 'move', to })).toEqual({ ok: false, reason: 'you are rooted' });
      }
      if (ate.outcome === 'stuffed') {
        const before = hero.time;
        act(world, 'p', { type: 'wait' });
        expect(hero.time - before).toBe(2);
      }
    }
    expect([...outcomes].sort()).toEqual(['hot', 'legs', 'stuffed', 'unwell', null].sort());
  });
});

describe('tall grass', () => {
  it('is trampled flat, sometimes shedding a dewdrop that heals', () => {
    const world = solo();
    const hero = heroById(world, 'p')!;
    const level = levelAt(world, 1);
    const home = hero.pos;
    const grass = NEIGHBOURS8.map((n) => home + n).find((c) => canEnter(level, c) && level.map[c] !== T.DOOR)!;
    let dew = 0;
    for (let i = 0; i < 60; i++) {
      level.map[grass] = T.HIGH_GRASS;
      act(world, 'p', { type: 'move', to: grass });
      expect(level.map[grass]).toBe(T.GRASS);
      const heap = floorAt(world, 1).heaps.find((h) => h.pos === grass);
      if (heap?.items.some((item) => item.kind === 'dew')) {
        dew++;
        hero.hp = hero.ht - 5;
        // Natural regeneration must not tick during the pickup.
        hero.regen = 0;
        const result = act(world, 'p', { type: 'pickup' });
        expect(result.ok && result.effects.find((e) => e.type === 'dew')).toEqual({ type: 'dew', hero: 'p', amount: 1 });
        expect(hero.hp).toBe(hero.ht - 4);
        expect(hero.items.some((item) => item.kind === 'dew')).toBe(false);
      }
      act(world, 'p', { type: 'move', to: home });
    }
    expect(dew).toBeGreaterThan(3);
  });
});

describe('food on the levels', () => {
  it('lies on every sewer level, more of it for a bigger party', () => {
    const count = (world: World, depth: number): number =>
      floorAt(world, depth).heaps.flatMap((h) => h.items).filter((i) => i.kind.startsWith('food.')).length;
    for (let seed = 1; seed <= 10; seed++) {
      const alone = createWorld(seed);
      addHero(alone, { id: 'a', name: 'A', heroClass: 'warrior' });
      const party = createWorld(seed);
      for (const id of ['a', 'b', 'c']) addHero(party, { id, name: id, heroClass: 'warrior' });
      for (let depth = 2; depth <= 4; depth++) {
        levelAt(alone, depth);
        levelAt(party, depth);
        expect(count(alone, depth)).toBeGreaterThanOrEqual(1);
        expect(count(party, depth)).toBeGreaterThanOrEqual(3);
      }
      expect(count(alone, 5)).toBe(0);
    }
  });
});
