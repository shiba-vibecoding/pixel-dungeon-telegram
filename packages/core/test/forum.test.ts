import { describe, expect, it } from 'vitest';
import { act, addHero, canEnter, charAt, createItem, createWorld, floorAt, heroById, levelAt, NEIGHBOURS8, T, type World } from '../src/index';
import { pacify } from './helpers';

/** Shattered's Well of Health lifts the curse from everything worn (WaterOfHealth.affectHero: Belongings.uncurseEquipped). */
describe('the well of health and curses', () => {
  const freeBeside = (world: World, pos: number): number => {
    const hero = heroById(world, 'p')!;
    const level = levelAt(world, hero.depth);
    return NEIGHBOURS8.map((n) => pos + n).find((c) => canEnter(level, c) && !charAt(world, hero.depth, c) && level.map[c] !== T.DOOR)!;
  };

  it('frees worn things of their curse, and leaves what is only carried', () => {
    for (let seed = 1; seed < 200; seed++) {
      const world = pacify(createWorld(seed));
      addHero(world, { id: 'p', name: 'P', heroClass: 'mage' });
      const depth = [1, 2, 3, 4].find((d) => levelAt(world, d).wells.some((w) => w.water === 'health'));
      if (!depth) continue;
      const well = levelAt(world, depth).wells.find((w) => w.water === 'health')!;
      const hero = heroById(world, 'p')!;
      hero.depth = depth;
      Object.assign(hero, { pos: freeBeside(world, well.pos), time: floorAt(world, depth).now });
      const worn = createItem('weapon.sword');
      Object.assign(worn, { cursed: true, curseUnknown: true, level: -1 });
      hero.weapon = worn;
      const carried = createItem('weapon.sword');
      Object.assign(carried, { cursed: true, curseUnknown: true });
      hero.items.push(carried);
      hero.hunger = 400;
      hero.hp = 1;
      expect(act(world, 'p', { type: 'move', to: well.pos }).ok).toBe(true);
      expect(hero.hp).toBe(hero.ht);
      expect(hero.hunger).toBe(0);
      expect(worn.cursed).toBeUndefined();
      expect(worn.curseUnknown).toBeUndefined();
      expect(carried.cursed).toBe(true);
      return;
    }
    throw new Error('no well of health');
  });
});
