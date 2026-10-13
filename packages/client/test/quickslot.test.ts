import { describe, expect, it } from 'vitest';
import { addHero, createWorld } from '@pd/core';
import {
  chooseQuickslot, isPlaceholder, QUICKSLOTS, quickIndex, quickKind, syncQuickslots, visibleQuickslots,
} from '../src/quickslot';

describe("quick slots (Shattered's QuickSlot)", () => {
  it("six slots; a new run starts with its class's, and the same run keeps what was chosen", () => {
    const world = createWorld(3);
    const hero = addHero(world, { id: 'p', name: 'P', heroClass: 'mage' });
    syncQuickslots(world, hero);
    expect(quickKind(0)).toBe('wand.magicMissile');
    expect(quickIndex(hero, 0)).toBe(hero.items.findIndex((i) => i.kind === 'wand.magicMissile'));
    chooseQuickslot('food.ration', 3);
    syncQuickslots(world, hero);
    expect(quickKind(3)).toBe('food.ration');
    // The same kind is never in two slots (QuickSlot.setSlot).
    chooseQuickslot('food.ration', 5);
    expect([quickKind(3), quickKind(5)]).toEqual([null, 'food.ration']);
    expect(QUICKSLOTS).toBe(6);
    const next = createWorld(4);
    const warrior = addHero(next, { id: 'p', name: 'P', heroClass: 'warrior' });
    syncQuickslots(next, warrior);
    expect(quickKind(0)).toBe('missile.throwingStone');
    expect(quickKind(5)).toBeNull();
  });

  it('a slot whose item is used up keeps it as a placeholder, filled again by the next one', () => {
    const world = createWorld(5);
    const hero = addHero(world, { id: 'p', name: 'P', heroClass: 'warrior' });
    syncQuickslots(world, hero);
    chooseQuickslot('food.ration', 1);
    const ration = hero.items.findIndex((i) => i.kind === 'food.ration');
    const [eaten] = hero.items.splice(ration, 1);
    expect(isPlaceholder(hero, 1)).toBe(true);
    expect(quickIndex(hero, 1)).toBe(-1);
    hero.items.push(eaten!);
    expect(isPlaceholder(hero, 1)).toBe(false);
  });

  it('four shown on a phone, five or six on wider ones, all six on a wide screen', () => {
    expect(visibleQuickslots(false, 360)).toBe(4);
    expect(visibleQuickslots(false, 400)).toBe(5);
    expect(visibleQuickslots(false, 480)).toBe(6);
    expect(visibleQuickslots(true, 1200)).toBe(6);
  });
});
