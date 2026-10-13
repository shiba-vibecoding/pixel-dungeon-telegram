import { describe, expect, it } from 'vitest';
import {
  act, addHero, canEnter, createItem, createMob, createWorld, floorAt, heroById, levelAt, NEIGHBOURS8, T, WIDTH,
  type World,
} from '../src/index';
import { pacify } from './helpers';

function solo(heroClass: 'warrior' | 'mage' = 'warrior', seed = 11): World {
  const world = pacify(createWorld(seed));
  addHero(world, { id: 'p', name: 'P', heroClass });
  heroById(world, 'p')!.items = [];
  return world;
}

/** A rat a few cells away along an open line, as in the ranged tests. */
function ratInSight(world: World): { ratPos: number } {
  const hero = heroById(world, 'p')!;
  const level = levelAt(world, 1);
  for (const dir of [1, -1, WIDTH, -WIDTH]) {
    const cells = [1, 2, 3].map((k) => hero.pos + dir * k);
    if (cells.every((c) => canEnter(level, c) && level.map[c] !== T.DOOR)) {
      const rat = createMob('#rat', 'rat', cells[2]!, 'hunting', floorAt(world, 1).now);
      floorAt(world, 1).mobs.push(rat);
      return { ratPos: rat.pos };
    }
  }
  throw new Error('no open line');
}

describe('harmful potions', () => {
  it('drunk, toxic gas chokes the drinker, and everyone learns what it was', () => {
    const world = solo();
    const hero = heroById(world, 'p')!;
    hero.items = [createItem('potion.toxicGas')];
    const result = act(world, 'p', { type: 'use', item: 0 });
    expect(result.ok && result.effects.find((e) => e.type === 'used')).toMatchObject({ identified: true });
    expect(result.ok && result.effects.some((e) => e.type === 'burst' && e.kind === 'toxic')).toBe(true);
    // The cloud lingers about the drinker, and hurts every turn spent in it.
    expect(floorAt(world, 1).gas?.toxic?.length).toBeGreaterThan(0);
    const before = hero.hp;
    act(world, 'p', { type: 'wait' });
    expect(hero.hp).toBeLessThan(before);
    expect(world.known).toContain('potion.toxicGas');
  });

  it('thrown, paralytic gas freezes the monsters around where it breaks', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const world = solo('warrior', seed);
      const hero = heroById(world, 'p')!;
      let ratPos: number;
      try {
        ({ ratPos } = ratInSight(world));
      } catch {
        continue;
      }
      hero.items = [createItem('potion.paralyticGas', 2)];
      const result = act(world, 'p', { type: 'throw', item: 0, target: ratPos });
      expect(result.ok && result.effects.find((e) => e.type === 'shattered')).toMatchObject({ pos: ratPos, identified: true });
      expect(hero.items[0]!.qty).toBe(1);
      // The gas reaches two cells: the rat is caught, the hero three cells back is not.
      expect(floorAt(world, 1).mobs.find((m) => m.id === '#rat')!.paralysed).toBeGreaterThan(0);
      expect(hero.paralysed).toBe(0);
      return;
    }
    throw new Error('no seed with an open line');
  });

  it('thrown, liquid flame sets a monster on fire until it burns down', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const world = solo('warrior', seed);
      const hero = heroById(world, 'p')!;
      let ratPos: number;
      try {
        ({ ratPos } = ratInSight(world));
      } catch {
        continue;
      }
      const level = levelAt(world, 1);
      if (level.map[ratPos] === T.WATER || level.map[ratPos] === T.WATER_TILES) continue;
      hero.items = [createItem('potion.liquidFlame')];
      act(world, 'p', { type: 'throw', item: 0, target: ratPos });
      const rat = floorAt(world, 1).mobs.find((m) => m.id === '#rat');
      expect(rat === undefined || (rat.burning ?? 0) > 0).toBe(true);
      // Flames do not reach two cells back to the hero.
      expect(hero.burning).toBe(0);
      return;
    }
    throw new Error('no seed with an open line');
  });

  it('a thrown healing potion splashes harmlessly and stays unknown', () => {
    const world = solo('mage');
    const hero = heroById(world, 'p')!;
    hero.items = [createItem('potion.healing')];
    const level = levelAt(world, 1);
    const target = NEIGHBOURS8.map((n) => hero.pos + n * 2).find((c) => canEnter(level, c))!;
    const result = act(world, 'p', { type: 'throw', item: 0, target });
    expect(result.ok && result.effects.find((e) => e.type === 'shattered')).toMatchObject({ identified: false });
    expect(result.ok && result.effects.some((e) => e.type === 'burst')).toBe(false);
    expect(world.known).not.toContain('potion.healing');
    expect(hero.items).toHaveLength(0);
  });
});

describe('fire', () => {
  it('burns down the barricade of a storage room', () => {
    for (let seed = 1; seed <= 80; seed++) {
      const world = pacify(createWorld(seed));
      for (let depth = 1; depth <= 4; depth++) {
        const level = levelAt(world, depth);
        const barricade = level.map.indexOf(T.BARRICADE);
        if (barricade < 0) continue;
        addHero(world, { id: 'p', name: 'P', heroClass: 'warrior' });
        const hero = heroById(world, 'p')!;
        hero.depth = depth;
        hero.pos = NEIGHBOURS8.map((n) => barricade + n).find((c) => canEnter(level, c))!;
        hero.items = [createItem('potion.liquidFlame')];
        const result = act(world, 'p', { type: 'use', item: 0 });
        expect(result.ok && result.effects.some((e) => e.type === 'burnt' && e.pos === barricade)).toBe(true);
        expect(level.map[barricade]).toBe(T.EMBERS);
        return;
      }
    }
    throw new Error('no storage room found');
  });
});

describe('scroll of recharging', () => {
  it('fills every wand', () => {
    const world = solo('mage');
    const hero = heroById(world, 'p')!;
    hero.items = [createItem('wand.magicMissile'), createItem('scroll.recharging')];
    hero.items[0]!.charges = 0;
    const result = act(world, 'p', { type: 'use', item: 1 });
    expect(result.ok && result.effects.find((e) => e.type === 'scroll')).toMatchObject({ kind: 'recharging', count: 1 });
    expect(hero.items[0]!.charges).toBe(3);
  });
});
