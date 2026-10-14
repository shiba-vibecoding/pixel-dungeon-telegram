import { describe, expect, it } from 'vitest';
import { act, addHero, createItem, createWorld, floorAt, heroById, itemDef, levelAt, Rng, T } from '../src/index';
import { transmute } from '../src/transmute';

describe('water of transmutation', () => {
  it('turns an item into another of its kind, keeping its level and curse', () => {
    const rng = Rng.seeded(3);
    // ScrollOfTransmutation.changeItem: potions and scrolls to their exotic counterparts and back.
    expect(transmute(createItem('potion.strength', 2), rng, 5)).toMatchObject({ kind: 'potion.mastery', qty: 2 });
    expect(transmute(createItem('potion.mastery'), rng, 5)!.kind).toBe('potion.strength');
    expect(transmute(createItem('scroll.upgrade'), rng, 5)!.kind).toBe('scroll.enchantment');
    // ScrollOfTransmutation.changeWeapon: another of the tier, keeping its level, curse and enchantment.
    const sword = transmute({ ...createItem('weapon.sword', 1, 2), cursed: true, enchant: 'wayward' }, rng, 5)!;
    expect(sword).toMatchObject({ level: 2, cursed: true, enchant: 'wayward' });
    expect(itemDef(sword.kind)).toMatchObject({ category: 'weapon', tier: 3 });
    expect(sword.kind).not.toBe('weapon.sword');
    const knives = transmute(createItem('missile.throwingKnife', 3), rng, 5)!;
    expect(itemDef(knives.kind)).toMatchObject({ category: 'missile', tier: 1 });
    expect(knives.qty).toBe(3);
    expect(transmute(createItem('missile.dart', 5), rng, 5)).toBeNull();
    expect(transmute(createItem('weapon.pickaxe'), rng, 5)).toBeNull();
    expect(transmute(createItem('food.ration'), rng, 5)).toBeNull();
    for (const kind of ['ring.haste', 'wand.fireblast', 'seed.sungrass', 'stone.blink', 'trinket.clover'] as const) {
      const changed = transmute(createItem(kind, 1, kind.startsWith('ring.') ? 2 : 0), rng, 5)!;
      expect(changed.kind).not.toBe(kind);
      expect(itemDef(changed.kind).category).toBe(itemDef(kind).category);
      expect(changed.kind).not.toBe('potion.strength');
      expect(changed.kind).not.toBe('scroll.upgrade');
    }
  });
});
