import { describe, expect, it } from 'vitest';
import { addHero, createWorld } from '@pd/core';
import {
  chooseQuickslot, isPlaceholder, QUICKSLOTS, quickIndex, quickItem, quickKind, setQuickCount, syncQuickslots, visibleQuickslots, WEAPON_SLOT,
} from '../src/quickslot';

describe("quick slots (Shattered's QuickSlot)", () => {
  it("six slots; a new run starts with its class's, and the same run keeps what was chosen", () => {
    const world = createWorld(3);
    const hero = addHero(world, { id: 'p', name: 'P', heroClass: 'mage' });
    syncQuickslots(world, hero);
    // The mage's staff, zapped from the hand (WEAPON_SLOT).
    expect(quickKind(0)).toBe('weapon.magesStaff');
    expect(quickIndex(hero, 0)).toBe(WEAPON_SLOT);
    expect(quickItem(hero, 0)).toBe(hero.weapon);
    expect(isPlaceholder(hero, 0)).toBe(false);
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

  it('the player picks 2, 4 or 6 quick slots on a phone (4 by default); a wide screen shows all six', () => {
    expect(visibleQuickslots(false)).toBe(4);
    setQuickCount(6);
    expect(visibleQuickslots(false)).toBe(6);
    setQuickCount(2);
    expect(visibleQuickslots(false)).toBe(2);
    expect(visibleQuickslots(true)).toBe(6);
    setQuickCount(4);
  });
});
