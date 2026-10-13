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

describe("hunger (Shattered's Hunger)", () => {
  it('sets every hero out with a ration', () => {
    const hero = heroById(solo('mage'), 'p')!;
    expect(hero.items.filter((item) => item.kind === 'food.ration')).toHaveLength(1);
  });

  it('grows a point a turn, warns when hungry at 300, then starves at 450 with a first blow', () => {
    const world = solo();
    const hero = heroById(world, 'p')!;
    const seen: string[] = [];
    let firstHurt = -1;
    for (let i = 0; i < 460; i++) {
      const result = act(world, 'p', { type: 'wait' });
      if (!result.ok) continue;
      for (const effect of result.effects) {
        if (effect.type === 'hunger') seen.push(`${effect.state}@${i + 1}`);
        if (effect.type === 'hurt' && firstHurt < 0) firstHurt = i + 1;
      }
    }
    expect(seen).toEqual(['hungry@300', 'starving@450']);
    expect(firstHurt).toBe(450);
    expect(hero.hunger).toBe(STARVING);
  });

  it("every class goes hungry alike (Pixel Dungeon's slow-to-hunger rogue is gone)", () => {
    for (const heroClass of ['warrior', 'rogue'] as const) {
      const world = solo(heroClass);
      waitTurns(world, 120);
      expect(heroById(world, 'p')!.hunger).toBe(120);
    }
  });

  it("stops healing, and drains a thousandth of the hero's health a turn", () => {
    const world = solo();
    const hero = heroById(world, 'p')!;
    hero.hunger = STARVING;
    hero.hp = 10;
    // 20 health: a point every fifty turns.
    waitTurns(world, 49);
    expect(hero.hp).toBe(10);
    waitTurns(world, 2);
    expect(hero.hp).toBe(9);
    waitTurns(world, 100);
    expect(hero.hp).toBe(7);
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

  it('a deliberate search works up an appetite: six hunger for its two turns', () => {
    const world = solo();
    const hero = heroById(world, 'p')!;
    act(world, 'p', { type: 'search' });
    expect(hero.hunger).toBe(6);
  });
});

describe('eating (Food.execute)', () => {
  it("takes three turns and takes a ration's worth of hunger away; nothing more, whatever the class", () => {
    for (const heroClass of ['warrior', 'mage'] as const) {
      const world = solo(heroClass);
      const hero = heroById(world, 'p')!;
      hero.hunger = 400;
      hero.hp = 10;
      const wand = hero.items.find((i) => i.kind === 'wand.magicMissile');
      if (wand) wand.charges = 0;
      const before = hero.time;
      const result = act(world, 'p', { type: 'use', item: hero.items.findIndex((i) => i.kind === 'food.ration') });
      expect(result.ok && result.effects.find((e) => e.type === 'ate')).toEqual({ type: 'ate', hero: 'p', kind: 'food.ration', outcome: null });
      expect(hero.time - before).toBe(3);
      // 400 less the ration's 300, and the three turns of eating.
      expect(hero.hunger).toBe(400 - HUNGRY + 3);
      expect(hero.hp).toBe(10);
      if (wand) expect(wand.charges).toBe(0);
      expect(hero.items.some((i) => i.kind === 'food.ration')).toBe(false);
    }
  });

  it('a pasty fills a starving hero up completely; mystery meat is half a ration', () => {
    const world = solo();
    const hero = heroById(world, 'p')!;
    hero.items = [createItem('food.pasty'), createItem('food.meat')];
    hero.hunger = STARVING;
    act(world, 'p', { type: 'use', item: 0 });
    expect(isStarving(hero)).toBe(false);
    expect(hero.hunger).toBe(3);
    hero.hunger = 200;
    act(world, 'p', { type: 'use', item: 0 });
    // Less the time eating took (six turns, if the meat left the hero stuffed and slow).
    expect(hero.hunger).toBeLessThanOrEqual(56);
    expect(hero.hunger).toBeGreaterThanOrEqual(50);
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
        // Slowed, a search takes twice as long; resting a turn is a turn whatever (Hero.rest: spendConstant).
        let before = hero.time;
        act(world, 'p', { type: 'search' });
        expect(hero.time - before).toBe(4);
        before = hero.time;
        act(world, 'p', { type: 'wait' });
        expect(hero.time - before).toBe(1);
      }
    }
    expect([...outcomes].sort()).toEqual(['hot', 'legs', 'stuffed', 'unwell', null].sort());
  });
});

describe('tall grass', () => {
  it('is trampled flat, sometimes shedding a dewdrop: into the waterskin, or, the waterskin full, a twentieth of the health', () => {
    const world = solo();
    const hero = heroById(world, 'p')!;
    const level = levelAt(world, 1);
    const home = hero.pos;
    const skin = hero.items.find((item) => item.kind === 'waterskin')!;
    const grass = NEIGHBOURS8.map((n) => home + n).find((c) => canEnter(level, c) && level.map[c] !== T.DOOR)!;
    let dew = 0;
    for (let i = 0; i < 60; i++) {
      level.map[grass] = T.HIGH_GRASS;
      act(world, 'p', { type: 'move', to: grass });
      expect(level.map[grass]).toBe(T.GRASS);
      const heap = floorAt(world, 1).heaps.find((h) => h.pos === grass);
      if (heap?.items.some((item) => item.kind === 'dew')) {
        dew++;
        if (dew === 1) {
          const result = act(world, 'p', { type: 'pickup' });
          expect(result.ok && result.effects.find((e) => e.type === 'dewCollected')).toEqual({ type: 'dewCollected', hero: 'p', full: false });
          expect(skin.volume).toBe(1);
        } else {
          skin.volume = 20;
          hero.hp = hero.ht - 5;
          // Natural regeneration must not tick during the pickup.
          hero.regen = 0;
          const result = act(world, 'p', { type: 'pickup' });
          expect(result.ok && result.effects.find((e) => e.type === 'dew')).toEqual({ type: 'dew', hero: 'p', amount: 1 });
          expect(hero.hp).toBe(hero.ht - 4);
        }
        expect(floorAt(world, 1).heaps.some((h) => h.pos === grass && h.items.some((item) => item.kind === 'dew'))).toBe(false);
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
