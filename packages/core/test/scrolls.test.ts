import { describe, expect, it } from 'vitest';
import {
  act, addHero, createItem, createWorld, heroById, type Hero, type ItemKind, scrollTargets, wandMaxCharges, type World,
} from '../src/index';
import { pacify } from './helpers';

/** A hero of a class with the party knowing the given scrolls, and the scroll first in the pack. */
function reader(heroClass: 'warrior' | 'mage' | 'rogue' | 'huntress', scroll: ItemKind, known = true): { world: World; hero: Hero } {
  const world = pacify(createWorld(8));
  const hero = addHero(world, { id: 'p', name: 'P', heroClass });
  hero.items.unshift(createItem(scroll, 2));
  if (known && !world.known.includes(scroll)) world.known.push(scroll);
  return { world, hero };
}

const slot = (hero: Hero, kind: ItemKind): number => hero.items.findIndex((item) => item.kind === kind);

describe('a scroll of upgrade, on the item chosen (WndBag)', () => {
  it('upgrades a wand in the pack: a level and a charge more', () => {
    const { world, hero } = reader('mage', 'scroll.upgrade');
    hero.items.push(createItem('wand.magicMissile'));
    const wand = hero.items[slot(hero, 'wand.magicMissile')]!;
    expect(wand.charges).toBe(3);
    const result = act(world, 'p', { type: 'use', item: 0, on: slot(hero, 'wand.magicMissile') });
    expect(result.ok && result.effects.some((e) => e.type === 'upgraded')).toBe(true);
    expect(wand).toMatchObject({ level: 1, charges: 4 });
    expect(wandMaxCharges(wand)).toBe(4);
    expect(hero.weapon!.level).toBe(0);
  });

  it("upgrades the mage's staff, and its wand with it: a level, a charge more (MagesStaff.updateWand)", () => {
    const { world, hero } = reader('mage', 'scroll.upgrade');
    const wand = hero.weapon!.wand!;
    wand.charges = 2;
    expect(act(world, 'p', { type: 'use', item: 0, on: 'weapon' }).ok).toBe(true);
    expect(hero.weapon!.level).toBe(1);
    expect(wand).toMatchObject({ level: 1, charges: 3 });
    expect(wandMaxCharges(wand, true)).toBe(5);
  });

  it('upgrades a worn ring, a ring in the pack, the boomerang and armour in the pack', () => {
    let { world, hero } = reader('rogue', 'scroll.upgrade');
    hero.ring = createItem('ring.evasion', 1, 1);
    expect(act(world, 'p', { type: 'use', item: 0, on: 'ring' }).ok).toBe(true);
    expect(hero.ring).toMatchObject({ kind: 'ring.evasion', level: 2 });
    hero.items.push({ ...createItem('ring.haste', 1, -1), cursed: true });
    expect(act(world, 'p', { type: 'use', item: 0, on: slot(hero, 'ring.haste') }).ok).toBe(true);
    // Upgraded, the curse is lifted (ScrollOfRemoveCurse.uncurse).
    expect(hero.items[slot(hero, 'ring.haste')]).toMatchObject({ level: 0 });
    expect(hero.items[slot(hero, 'ring.haste')]!.cursed).toBeUndefined();

    ({ world, hero } = reader('huntress', 'scroll.upgrade'));
    hero.items.push(createItem('armor.leather'));
    expect(act(world, 'p', { type: 'use', item: 0, on: slot(hero, 'missile.boomerang') }).ok).toBe(true);
    expect(hero.items[slot(hero, 'missile.boomerang')]!.level).toBe(1);
    expect(act(world, 'p', { type: 'use', item: 0, on: slot(hero, 'armor.leather') }).ok).toBe(true);
    expect(hero.items[slot(hero, 'armor.leather')]!.level).toBe(1);
    expect(hero.armor.level).toBe(0);
  });

  it('upgrades the weapon in hand or one in the pack', () => {
    const { world, hero } = reader('warrior', 'scroll.upgrade');
    hero.items.push(createItem('weapon.mace'));
    expect(act(world, 'p', { type: 'use', item: 0, on: 'weapon' }).ok).toBe(true);
    expect(hero.weapon!.level).toBe(1);
    expect(act(world, 'p', { type: 'use', item: 0, on: slot(hero, 'weapon.mace') }).ok).toBe(true);
    expect(hero.items[slot(hero, 'weapon.mace')]!.level).toBe(1);
  });

  it('refuses what cannot be upgraded before the scroll is used up', () => {
    const { world, hero } = reader('warrior', 'scroll.upgrade');
    hero.items.push(createItem('potion.healing'), createItem('artifact.cape', 1, 1));
    const fails = (on: unknown, reason: string): void => {
      expect(act(world, 'p', { type: 'use', item: 0, on } as never)).toEqual({ ok: false, reason });
    };
    fails(slot(hero, 'potion.healing'), 'that cannot be upgraded');
    fails(slot(hero, 'missile.dart'), 'that cannot be upgraded');
    fails(slot(hero, 'artifact.cape'), 'that cannot be upgraded');
    fails(0, 'that cannot be upgraded');
    fails(99, 'no such item');
    fails('ring', 'no such item');
    fails('ring5', 'bad target');
    hero.armor = createItem('armor.warrior');
    fails('armor', 'that cannot be upgraded');
    expect(hero.items[0]!.qty).toBe(2);
  });

  it('still takes the old `target` of older clients', () => {
    const { world, hero } = reader('warrior', 'scroll.upgrade');
    expect(act(world, 'p', { type: 'use', item: 0, target: 'armor' }).ok).toBe(true);
    expect(hero.armor.level).toBe(1);
    expect(hero.weapon!.level).toBe(0);
  });

  it('read unknown, it falls back on the weapon in hand whatever was chosen', () => {
    const { world, hero } = reader('warrior', 'scroll.upgrade', false);
    hero.items.push(createItem('potion.healing'));
    expect(act(world, 'p', { type: 'use', item: 0, on: slot(hero, 'potion.healing') }).ok).toBe(true);
    expect(hero.weapon!.level).toBe(1);
    expect(world.known).toContain('scroll.upgrade');
  });
});

describe('a scroll of enchantment, on the item chosen', () => {
  it('inscribes armour in the pack, and refuses a wand', () => {
    const { world, hero } = reader('mage', 'scroll.enchantment');
    hero.items.push(createItem('armor.scale'), createItem('wand.magicMissile'));
    expect(act(world, 'p', { type: 'use', item: 0, on: slot(hero, 'armor.scale') }).ok).toBe(true);
    expect(hero.items[slot(hero, 'armor.scale')]!.glyph).toBeDefined();
    expect(hero.armor.glyph).toBeUndefined();
    expect(act(world, 'p', { type: 'use', item: 0, on: slot(hero, 'wand.magicMissile') })).toEqual({
      ok: false, reason: 'that cannot be enchanted',
    });
  });
});

describe('a scroll of identify, on the item chosen', () => {
  it('tells what the chosen item is, not the first unknown one', () => {
    const { world, hero } = reader('warrior', 'scroll.identify');
    hero.items.push(createItem('potion.frost'), createItem('ring.haste'));
    world.known = world.known.filter((kind) => kind !== 'potion.frost' && kind !== 'ring.haste');
    expect(scrollTargets(world, hero, 'scroll.identify')).toEqual([slot(hero, 'potion.frost'), slot(hero, 'ring.haste')]);
    expect(act(world, 'p', { type: 'use', item: 0, on: slot(hero, 'ring.haste') }).ok).toBe(true);
    expect(world.known).toContain('ring.haste');
    expect(world.known).not.toContain('potion.frost');
    expect(act(world, 'p', { type: 'use', item: 0, on: slot(hero, 'ring.haste') })).toEqual({
      ok: false, reason: 'there is nothing to learn about that',
    });
  });
});

describe('scrollTargets', () => {
  it('lists what a scroll can be read on, worn items first', () => {
    const { world, hero } = reader('rogue', 'scroll.upgrade');
    hero.ring = createItem('ring.evasion', 1, 1);
    hero.items.push(createItem('potion.healing'), createItem('wand.frost'));
    expect(scrollTargets(world, hero, 'scroll.upgrade')).toEqual(['weapon', 'armor', 'ring', slot(hero, 'wand.frost')]);
    expect(scrollTargets(world, hero, 'scroll.enchantment')).toEqual(['weapon', 'armor']);
    expect(scrollTargets(world, hero, 'scroll.mapping')).toEqual([]);
  });
});
