import { describe, expect, it } from 'vitest';
import {
  act, addHero, canEnter, charAt, createItem, createMob, createWorld, floorAt, heroById, levelAt, NEIGHBOURS8, RoomType, T, type World,
} from '../src/index';

/** A run with an altar room on one of the first depths, and a hero standing next to its fire. */
function atAltar(): { world: World; depth: number; fire: number } {
  for (let seed = 1; seed < 80; seed++) {
    const world = createWorld(seed);
    for (let depth = 1; depth <= 9; depth++) {
      const level = levelAt(world, depth);
      const altar = floorAt(world, depth).altar;
      if (!altar || !level.rooms.some((r) => r.type === RoomType.ALTAR)) continue;
      floorAt(world, depth).mobs = [];
      floorAt(world, depth).respawn = 1e9;
      addHero(world, { id: 'p', name: 'P', heroClass: 'warrior' });
      const hero = heroById(world, 'p')!;
      Object.assign(hero, { depth, time: floorAt(world, depth).now, attackSkill: 1000, hp: 500, ht: 500 });
      hero.pos = NEIGHBOURS8.map((n) => altar.pos + n).find((c) => canEnter(level, c) && !charAt(world, depth, c))!;
      return { world, depth, fire: altar.pos };
    }
  }
  throw new Error('no altar in 80 runs');
}

describe('the altar and its sacrificial fire', () => {
  it('burns on a pedestal in the middle of the room, hungry for 6 + 4 x depth, a cursed weapon its prize', () => {
    const { world, depth, fire } = atAltar();
    expect(levelAt(world, depth).map[fire]).toBe(T.PEDESTAL);
    expect(floorAt(world, depth).altar!.volume).toBe(6 + depth * 4);
    const prize = floorAt(world, depth).altar!.prize!;
    expect(prize.cursed).toBe(true);
  });

  it('marks whoever stands by it; marked monsters slain are offerings, and when it has had enough it leaves its prize', () => {
    const { world, depth, fire } = atAltar();
    const floor = floorAt(world, depth);
    floor.altar!.volume = 3;
    const prize = floor.altar!.prize!;
    for (let i = 0; i < 6 && floor.altar!.volume > 0; i++) {
      const rat = createMob(`#r${i}`, 'rat', fire, 'hunting', floor.now);
      Object.assign(rat, { enemy: 'p', enemySeen: true });
      floor.mobs.push(rat);
      act(world, 'p', { type: 'wait' });
      expect(rat.marked).toBeGreaterThan(0);
      for (let k = 0; k < 20 && floor.mobs.includes(rat); k++) act(world, 'p', { type: 'attack', target: rat.id });
    }
    expect(floor.altar!.volume).toBe(0);
    expect(floor.heaps.find((h) => h.pos === fire)?.items).toContainEqual(prize);
  });

  it('the scroll of wipe out kills every monster on the level but the quest givers, and frees what was for sale', () => {
    const { world, depth } = atAltar();
    const floor = floorAt(world, depth);
    const hero = heroById(world, 'p')!;
    const free = levelAt(world, depth).map.map((_, c) => c).filter((c) => canEnter(levelAt(world, depth), c) && !charAt(world, depth, c));
    floor.mobs.push(createMob('#a', 'gnoll', free[0]!, 'sleeping', floor.now), createMob('#b', 'crab', free[1]!, 'wandering', floor.now));
    floor.mobs.push(createMob('#k', 'shopkeeper', free[2]!, 'passive', floor.now));
    floor.heaps.push({ pos: free[3]!, kind: 'forSale', items: [createItem('potion.healing')] });
    hero.items = [createItem('wipeOut')];
    expect(act(world, 'p', { type: 'use', item: 0 }).ok).toBe(true);
    expect(floor.mobs).toEqual([]);
    expect(floor.heaps.find((h) => h.pos === free[3])?.kind).toBe('heap');
    expect(hero.items).toEqual([]);
  });
});
