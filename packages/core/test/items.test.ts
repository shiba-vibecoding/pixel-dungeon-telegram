import { describe, expect, it } from 'vitest';
import {
  act, addHero, createItem, createWorld, F, floorAt, hasFlag, heroById, isAlive, type ItemKind, ITEMS, itemDef,
  levelAt, RoomType, weaponStats, type World,
  WIDTH,
} from '../src/index';
import { pacify } from './helpers';

/** A hero with an empty backpack, for tests about what goes in and out of it. */
function soloAt(seed: number, heroClass: 'warrior' | 'mage' = 'warrior'): World {
  const world = pacify(createWorld(seed));
  addHero(world, { id: 'p', name: 'P', heroClass });
  heroById(world, 'p')!.items = [];
  return world;
}

describe('items on the levels', () => {
  it('lie in standard rooms of every sewer level, but not in the lair', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const world = createWorld(seed);
      for (let depth = 1; depth <= 4; depth++) {
        const level = levelAt(world, depth);
        const heaps = floorAt(world, depth).heaps;
        expect(heaps.reduce((n, heap) => n + heap.items.length, 0)).toBeGreaterThanOrEqual(3);
        for (const heap of heaps) {
          expect(hasFlag(level.map[heap.pos]!, F.PASSABLE), `heap at ${heap.pos}`).toBe(true);
          for (const item of heap.items) {
            expect(ITEMS[item.kind]).toBeDefined();
            expect(item.qty).toBeGreaterThan(0);
          }
        }
        expect(new Set(heaps.map((h) => h.pos)).size).toBe(heaps.length);
      }
      // The lair holds only the Rat King's chests, if anything.
      expect(floorAt(world, 5).heaps.every((h) => h.kind === 'chest' || h.kind === 'mimic')).toBe(true);
      // Strength and upgrades are guaranteed over the sewers.
      expect(world.run.strengthFound).toBeGreaterThanOrEqual(1);
      expect(world.run.strengthFound).toBeLessThanOrEqual(2);
      expect(world.run.upgradesFound).toBeGreaterThanOrEqual(1);
    }
  });

  it('gives every potion and scroll kind its own colour or rune, fixed per run', () => {
    const a = createWorld(42).run.labels;
    expect(createWorld(42).run.labels).toEqual(a);
    for (const category of ['potion', 'scroll'] as const) {
      const kinds = (Object.keys(ITEMS) as ItemKind[]).filter((k) => itemDef(k).category === category);
      const labels = kinds.map((k) => a[k]);
      expect(new Set(labels).size).toBe(kinds.length);
    }
    expect(createWorld(43).run.labels).not.toEqual(a);
  });
});

describe('the backpack', () => {
  it('picks up a heap, opening chests and pocketing gold', () => {
    const world = soloAt(1);
    const hero = heroById(world, 'p')!;
    floorAt(world, 1).heaps.push({
      pos: hero.pos, kind: 'chest', items: [createItem('gold', 37), createItem('potion.healing'), createItem('weapon.mace')],
    });
    const result = act(world, 'p', { type: 'pickup' });
    expect(result.ok).toBe(true);
    expect(hero.gold).toBe(37);
    expect(hero.items.map((i) => i.kind)).toEqual(['potion.healing', 'weapon.mace']);
    expect(floorAt(world, 1).heaps.some((h) => h.pos === hero.pos)).toBe(false);
    expect(result.ok && result.effects.map((e) => e.type)).toEqual(['opened', 'pickedUp', 'pickedUp', 'pickedUp']);
    expect(act(world, 'p', { type: 'pickup' })).toEqual({ ok: false, reason: 'nothing here' });
  });

  it('heals with a potion, and the whole party learns what it was', () => {
    const world = soloAt(2);
    addHero(world, { id: 'q', name: 'Q', heroClass: 'rogue' });
    const hero = heroById(world, 'p')!;
    hero.items.push(createItem('potion.healing', 2));
    hero.hp = 5;
    hero.ooze = 0;
    expect(world.known).not.toContain('potion.healing');
    const result = act(world, 'p', { type: 'use', item: 0 });
    expect(result.ok && result.effects).toContainEqual({ type: 'used', hero: 'p', kind: 'potion.healing', identified: true });
    expect(hero).toMatchObject({ hp: 20, ooze: -1 });
    expect(hero.items[0]!.qty).toBe(1);
    expect(world.known).toContain('potion.healing');
  });

  it('equips better weapons and upgrades them with scrolls', () => {
    const world = soloAt(3);
    const hero = heroById(world, 'p')!;
    hero.items.push(createItem('weapon.sword'), createItem('scroll.upgrade'));
    expect(act(world, 'p', { type: 'equip', item: 0 }).ok).toBe(true);
    expect(hero.weapon!.kind).toBe('weapon.sword');
    expect(hero.items[0]!.kind).toBe('weapon.wornShortsword');
    expect(act(world, 'p', { type: 'use', item: 1, target: 'weapon' }).ok).toBe(true);
    expect(hero.weapon!.level).toBe(1);
    expect(weaponStats(hero.weapon!)).toMatchObject({ min: 4, str: 13 });
    expect(act(world, 'p', { type: 'equip', item: 5 }).ok).toBe(false);
    expect(act(world, 'p', { type: 'use', item: 0 })).toEqual({ ok: false, reason: 'that cannot be used' });
  });

  it('hands items over: one hero drops, another picks up', () => {
    const world = soloAt(4, 'mage');
    addHero(world, { id: 'q', name: 'Q', heroClass: 'warrior' });
    const mage = heroById(world, 'p')!;
    const warrior = heroById(world, 'q')!;
    mage.items = [createItem('potion.healing')];
    warrior.items = [];
    expect(act(world, 'p', { type: 'drop', item: 0 }).ok).toBe(true);
    expect(mage.items).toEqual([]);
    // The warrior steps onto the mage's cell once the mage has moved away.
    const spot = mage.pos;
    const level = levelAt(world, 1);
    const away = [1, -1, 32, -32, 33, -33, 31, -31].map((d) => spot + d).find(
      (c) => hasFlag(level.map[c]!, F.PASSABLE) && c !== warrior.pos,
    )!;
    expect(act(world, 'p', { type: 'move', to: away }).ok).toBe(true);
    warrior.pos = spot;
    expect(act(world, 'q', { type: 'pickup' }).ok).toBe(true);
    expect(warrior.items.map((i) => i.kind)).toEqual(['potion.healing']);
  });

  it('maps the level and finds its secrets with a scroll of magic mapping', () => {
    let mapped = 0;
    for (let seed = 1; seed <= 30 && mapped < 3; seed++) {
      const world = soloAt(seed);
      const level = levelAt(world, 3);
      if (!level.map.some((t) => hasFlag(t, F.SECRET))) continue;
      const hero = heroById(world, 'p')!;
      Object.assign(hero, { depth: 3, pos: level.entrance });
      hero.items.push(createItem('scroll.mapping'));
      expect(act(world, 'p', { type: 'use', item: 0 }).ok).toBe(true);
      expect(level.map.some((t) => hasFlag(t, F.SECRET))).toBe(false);
      expect(world.explored[3]![level.exit]).toBe(true);
      mapped++;
    }
    expect(mapped).toBeGreaterThan(0);
  });

  it('puts monsters in sight to sleep with a lullaby', () => {
    const world = createWorld(5);
    addHero(world, { id: 'p', name: 'P', heroClass: 'warrior' });
    const hero = heroById(world, 'p')!;
    const mob = floorAt(world, 1).mobs[0]!;
    mob.state = 'hunting';
    mob.pos = hero.pos + 2;
    hero.items.push(createItem('scroll.lullaby'));
    const result = act(world, 'p', { type: 'use', item: hero.items.length - 1 });
    expect(result.ok).toBe(true);
    expect(isAlive(mob) && mob.state).toBe('sleeping');
  });

  it('keeps loot in rooms, never at the entrance or in corridors', () => {
    for (let seed = 1; seed <= 15; seed++) {
      const world = createWorld(seed * 31);
      for (let depth = 1; depth <= 4; depth++) {
        const level = levelAt(world, depth);
        for (const heap of floorAt(world, depth).heaps) {
          const x = heap.pos % WIDTH;
          const y = Math.trunc(heap.pos / WIDTH);
          const room = level.rooms.find((r) => x > r.left && x < r.right && y > r.top && y < r.bottom);
          expect(room, `heap at ${heap.pos} on depth ${depth}`).toBeDefined();
          expect([RoomType.ENTRANCE, RoomType.TUNNEL, RoomType.PASSAGE]).not.toContain(room!.type);
        }
      }
    }
  });
});
