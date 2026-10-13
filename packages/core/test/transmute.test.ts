import { describe, expect, it } from 'vitest';
import { act, addHero, createItem, createWorld, floorAt, heroById, itemDef, levelAt, Rng, T } from '../src/index';
import { transmute } from '../src/transmute';

describe('water of transmutation', () => {
  it('turns an item into another of its kind, keeping its level and curse', () => {
    const rng = Rng.seeded(3);
    expect(transmute(createItem('potion.strength', 2), rng, 5)).toMatchObject({ kind: 'potion.might', qty: 2 });
    expect(transmute(createItem('scroll.upgrade'), rng, 5)!.kind).toBe('scroll.enchantment');
    expect(transmute({ ...createItem('weapon.sword', 1, -2), cursed: true }, rng, 5)).toMatchObject({ kind: 'weapon.mace', level: -2, cursed: true });
    expect(transmute(createItem('weapon.shortSword'), rng, 5)).toBeNull();
    expect(transmute(createItem('food.ration'), rng, 5)).toBeNull();
    for (const kind of ['ring.haste', 'wand.fireblast', 'seed.sungrass', 'scroll.identify', 'potion.healing'] as const) {
      const changed = transmute(createItem(kind, 1, kind.startsWith('ring.') ? 2 : 0), rng, 5)!;
      expect(changed.kind).not.toBe(kind);
      expect(itemDef(changed.kind).category).toBe(itemDef(kind).category);
      expect(changed.kind).not.toBe('potion.strength');
      expect(changed.kind).not.toBe('scroll.upgrade');
    }
  });

  it('works on what is dropped into the well, which then runs dry; wading in does nothing', () => {
    for (let seed = 1; seed < 400; seed++) {
      const world = createWorld(seed * 7);
      for (let depth = 1; depth <= 4; depth++) {
        const level = levelAt(world, depth);
        const well = level.wells.find((w) => w.water === 'transmutation');
        if (!well) continue;
        addHero(world, { id: 'p', name: 'P', heroClass: 'warrior' });
        const hero = heroById(world, 'p')!;
        Object.assign(hero, { depth, pos: well.pos, time: floorAt(world, depth).now });
        hero.items = [createItem('potion.strength')];
        const result = act(world, 'p', { type: 'drop', item: 0 });
        expect(result.ok && result.effects.some((e) => e.type === 'transmuted')).toBe(true);
        expect(level.map[well.pos]).toBe(T.EMPTY_WELL);
        expect(floorAt(world, depth).heaps.find((h) => h.pos === well.pos)!.items[0]!.kind).toBe('potion.might');
        return;
      }
    }
    throw new Error('no well of transmutation');
  });
});
