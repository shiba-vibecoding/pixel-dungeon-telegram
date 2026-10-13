import { describe, expect, it } from 'vitest';
import {
  act, addHero, canEnter, charAt, createItem, createMob, createWorld, floorAt, hasRoom, heroById, inBag, levelAt, NEIGHBOURS8, slotsUsed,
} from '../src/index';
import { pacify } from './helpers';

describe('the waterskin (Waterskin, Dewdrop)', () => {
  it('every hero sets out with one; the dew vial no longer turns up', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const world = createWorld(seed);
      for (const heroClass of ['warrior', 'mage', 'rogue', 'huntress'] as const) addHero(world, { id: heroClass, name: heroClass, heroClass });
      for (const hero of world.heroes) expect(hero.items.filter((i) => i.kind === 'waterskin')).toHaveLength(1);
      for (let d = 1; d <= 3; d++) levelAt(world, d);
      const skins = [1, 2, 3].flatMap((d) => floorAt(world, d).heaps.flatMap((h) => h.items.filter((i) => i.kind === 'waterskin')));
      expect(skins, `seed ${seed}`).toHaveLength(0);
    }
  });

  it('keeps the dew picked up, twenty drops at most, and gives only as many as the wounds need', () => {
    const world = pacify(createWorld(4));
    addHero(world, { id: 'p', name: 'P', heroClass: 'mage' });
    const hero = heroById(world, 'p')!;
    hero.items = [createItem('waterskin')];
    expect(act(world, 'p', { type: 'use', item: 0 })).toEqual({ ok: false, reason: 'your waterskin is empty' });
    // Picked up hurt or not, dew goes into the waterskin while there is room.
    hero.hp = 15;
    floorAt(world, 1).heaps.push({ pos: hero.pos, kind: 'heap', items: [createItem('dew', 5)] });
    act(world, 'p', { type: 'pickup' });
    expect(hero.items[0]!.volume).toBe(5);
    expect(hero.hp).toBeLessThanOrEqual(16);
    // Each drop is 5% of 20 health: one point. Ten missing: ten drops wanted, five there.
    hero.hp = 10;
    hero.regen = 0;
    const result = act(world, 'p', { type: 'use', item: 0 });
    expect(result.ok && result.effects.find((e) => e.type === 'vial')).toEqual({ type: 'vial', hero: 'p', amount: 5 });
    expect(hero.hp).toBe(15);
    expect(hero.items[0]!.volume).toBe(0);
    // Full, it gives four drops for four points, and keeps the rest.
    hero.items[0]!.volume = 20;
    hero.hp = 16;
    hero.regen = 0;
    act(world, 'p', { type: 'use', item: 0 });
    expect(hero.hp).toBe(20);
    expect(hero.items[0]!.volume).toBe(16);
  });

  it('full, dew heals at once; an unhurt hero leaves it lying, unless on the stairs', () => {
    const world = pacify(createWorld(4));
    addHero(world, { id: 'p', name: 'P', heroClass: 'mage' });
    const hero = heroById(world, 'p')!;
    hero.items = [{ ...createItem('waterskin'), volume: 20 }];
    // Off the stairs, where a dewdrop would be drunk anyway (to let the hero through).
    hero.pos = NEIGHBOURS8.map((n) => hero.pos + n).find((c) => canEnter(levelAt(world, 1), c))!;
    floorAt(world, 1).heaps.push({ pos: hero.pos, kind: 'heap', items: [createItem('dew')] });
    const result = act(world, 'p', { type: 'pickup' });
    expect(result.ok && result.effects.some((e) => e.type === 'dewFull')).toBe(true);
    expect(floorAt(world, 1).heaps.some((h) => h.pos === hero.pos)).toBe(true);
    hero.hp = 10;
    hero.regen = 0;
    act(world, 'p', { type: 'pickup' });
    expect(hero.hp).toBe(11);
    expect(floorAt(world, 1).heaps.some((h) => h.pos === hero.pos)).toBe(false);
  });

  it('no longer saves its bearer from a deadly blow', () => {
    const world = pacify(createWorld(4));
    addHero(world, { id: 'p', name: 'P', heroClass: 'mage' });
    const hero = heroById(world, 'p')!;
    hero.items = [{ ...createItem('waterskin'), volume: 20 }];
    hero.hp = 1;
    hero.poison = 5;
    act(world, 'p', { type: 'wait' });
    expect(hero.hp).toBeLessThanOrEqual(0);
    expect(hero.items[0]!.volume).toBe(20);
  });
});

describe('bags', () => {
  it('hold their own kind without taking room in the backpack, up to their size; keys never take room', () => {
    const world = pacify(createWorld(4));
    addHero(world, { id: 'p', name: 'P', heroClass: 'mage' });
    const hero = heroById(world, 'p')!;
    hero.items = Array.from({ length: 19 }, () => createItem('weapon.dagger'));
    hero.items.push(createItem('bag.scrolls'));
    expect(slotsUsed(hero)).toBe(20);
    expect(hasRoom(hero, createItem('weapon.sword'))).toBe(false);
    expect(hasRoom(hero, { ...createItem('key.iron'), depth: 1 })).toBe(true);
    const scrolls = (['scroll.identify', 'scroll.teleportation', 'scroll.mapping'] as const).map((kind) => createItem(kind));
    for (const scroll of scrolls) {
      expect(hasRoom(hero, scroll)).toBe(true);
      hero.items.push(scroll);
    }
    expect(slotsUsed(hero)).toBe(20);
    expect(scrolls.every((scroll) => inBag(hero, scroll))).toBe(true);
    expect(hasRoom(hero, createItem('seed.firebloom'))).toBe(false);
  });
});
