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
    for (const kind of ['ring.haste', 'wand.firebolt', 'seed.sungrass', 'scroll.identify', 'potion.healing'] as const) {
      const changed = transmute(createItem(kind, 1, kind.startsWith('ring.') ? 2 : 0), rng, 5)!;
      expect(changed.kind).not.toBe(kind);
      expect(itemDef(changed.kind).category).toBe(itemDef(kind).category);
      expect(changed.kind).not.toBe('potion.strength');
      expect(changed.kind).not.toBe('scroll.upgrade');
    }
  });
});
