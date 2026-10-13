import { describe, expect, it } from 'vitest';
import {
  enchantOptions, labelKind, act, addHero, createItem, createWorld, heroById, type Hero, type ItemKind, scrollTargets, wandMaxCharges, type World,
} from '../src/index';
import { pacify } from './helpers';

/** A hero of a class with the party knowing the given scrolls, and the scroll first in the pack. */
function reader(heroClass: 'warrior' | 'mage' | 'rogue' | 'huntress', scroll: ItemKind, known = true): { world: World; hero: Hero } {
  const world = pacify(createWorld(8));
  const hero = addHero(world, { id: 'p', name: 'P', heroClass });
  hero.items.unshift(createItem(scroll, 2));
  if (known && !world.known.includes(labelKind(scroll))) world.known.push(labelKind(scroll));
  return { world, hero };
}

const slot = (hero: Hero, kind: ItemKind): number => hero.items.findIndex((item) => item.kind === kind);

describe('a scroll of upgrade, on the item chosen (WndBag)', () => {
  it('upgrades a wand in the pack: a level and a charge more', () => {
    const { world, hero } = reader('mage', 'scroll.upgrade');
    const wand = hero.items[slot(hero, 'wand.magicMissile')]!;
    expect(wand.charges).toBe(3);
    const result = act(world, 'p', { type: 'use', item: 0, on: slot(hero, 'wand.magicMissile') });
    expect(result.ok && result.effects.some((e) => e.type === 'upgraded')).toBe(true);
    expect(wand).toMatchObject({ level: 1, charges: 4 });
    expect(wandMaxCharges(wand)).toBe(4);
    expect(hero.weapon!.level).toBe(0);
  });

  it('upgrades a worn ring, a ring in the pack, the boomerang and armour in the pack', () => {
    let { world, hero } = reader('rogue', 'scroll.upgrade');
    expect(act(world, 'p', { type: 'use', item: 0, on: 'ring0' }).ok).toBe(true);
    expect(hero.rings[0]).toMatchObject({ kind: 'ring.shadows', level: 2 });
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
    hero.items.push(createItem('potion.healing'), createItem('ring.thorns', 1, 1));
    const fails = (on: unknown, reason: string): void => {
      expect(act(world, 'p', { type: 'use', item: 0, on } as never)).toEqual({ ok: false, reason });
    };
    fails(slot(hero, 'potion.healing'), 'that cannot be upgraded');
    fails(slot(hero, 'missile.dart'), 'that cannot be upgraded');
    fails(slot(hero, 'ring.thorns'), 'that cannot be upgraded');
    fails(0, 'that cannot be upgraded');
    fails(99, 'no such item');
    fails('ring1', 'no such item');
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
    hero.items.push(createItem('armor.scale'));
    // ScrollOfEnchantment: one of three glyphs, chosen.
    expect(act(world, 'p', { type: 'use', item: 0, on: slot(hero, 'armor.scale') })).toEqual({ ok: false, reason: 'choose an enchantment' });
    const options = enchantOptions(world, hero, hero.items[slot(hero, 'armor.scale')]!);
    expect(new Set(options).size).toBe(3);
    expect(act(world, 'p', { type: 'use', item: 0, on: slot(hero, 'armor.scale'), choice: 1 }).ok).toBe(true);
    expect(hero.items[slot(hero, 'armor.scale')]!.glyph).toBe(options[1]);
    expect(hero.armor.glyph).toBeUndefined();
    expect(act(world, 'p', { type: 'use', item: 0, on: slot(hero, 'wand.magicMissile'), choice: 0 })).toEqual({
      ok: false, reason: 'that cannot be enchanted',
    });
  });
});

describe('a scroll of identify, on the item chosen', () => {
  it('tells what the chosen item is, not the first unknown one', () => {
    const { world, hero } = reader('warrior', 'scroll.identify');
    hero.items.push(createItem('potion.frost'), createItem('wand.firebolt'));
    world.known = world.known.filter((kind) => kind !== 'potion.frost' && kind !== 'wand.firebolt');
    expect(scrollTargets(world, hero, 'scroll.identify')).toEqual([slot(hero, 'potion.frost'), slot(hero, 'wand.firebolt')]);
    expect(act(world, 'p', { type: 'use', item: 0, on: slot(hero, 'wand.firebolt') }).ok).toBe(true);
    expect(world.known).toContain('wand.firebolt');
    expect(world.known).not.toContain('potion.frost');
    expect(act(world, 'p', { type: 'use', item: 0, on: slot(hero, 'wand.firebolt') })).toEqual({
      ok: false, reason: 'there is nothing to learn about that',
    });
  });
});

describe('scrollTargets', () => {
  it('lists what a scroll can be read on, worn items first', () => {
    const { world, hero } = reader('rogue', 'scroll.upgrade');
    hero.items.push(createItem('potion.healing'), createItem('wand.slowness'));
    expect(scrollTargets(world, hero, 'scroll.upgrade')).toEqual(['weapon', 'armor', 'ring0', slot(hero, 'wand.slowness')]);
    expect(scrollTargets(world, hero, 'scroll.enchantment')).toEqual(['weapon', 'armor']);
    expect(scrollTargets(world, hero, 'scroll.mapping')).toEqual([]);
  });
});
