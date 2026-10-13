import { describe, expect, it } from 'vitest';
import {
  act, addHero, canEnter, charAt, createItem, createMob, createWorld, type Effect, effectiveLevel, floorAt, heroById,
  isBroken, levelAt, maxDurability, NEIGHBOURS8, weaponStats, type World,
} from '../src/index';
import { pacify } from './helpers';

/** A hero beside a dummy that can take any number of blows. */
function sparring(): { world: World; target: string } {
  const world = pacify(createWorld(5));
  addHero(world, { id: 'p', name: 'P', heroClass: 'warrior' });
  const hero = heroById(world, 'p')!;
  Object.assign(hero, { attackSkill: 10000, str: 20 });
  const level = levelAt(world, 1);
  const floor = floorAt(world, 1);
  const pos = NEIGHBOURS8.map((n) => hero.pos + n).find((c) => canEnter(level, c) && !charAt(world, 1, c))!;
  const dummy = createMob('#dummy', 'rat', pos, 'hunting', floor.now);
  Object.assign(dummy, { ht: 1e9, hp: 1e9, attack: 0 });
  floor.mobs.push(dummy);
  return { world, target: dummy.id };
}

function strike(world: World, target: string, times: number): Effect[] {
  const effects: Effect[] = [];
  const hero = heroById(world, 'p')!;
  for (let i = 0; i < times; i++) {
    hero.hp = hero.ht;
    const result = act(world, 'p', { type: 'attack', target });
    if (result.ok) effects.push(...result.effects);
  }
  return effects;
}

describe('wear (Item.use)', () => {
  it('an upgraded weapon wears with every blow that lands, warns, and breaks into a plain one', () => {
    const { world, target } = sparring();
    const hero = heroById(world, 'p')!;
    hero.weapon = createItem('weapon.sword', 1, 3);
    const whole = weaponStats(hero.weapon);
    const uses = maxDurability(hero.weapon);
    expect(uses).toBe(5 * 13);
    const effects = strike(world, target, uses + 5);
    expect(effects.some((e) => e.type === 'worn' && e.state === 'warning')).toBe(true);
    expect(effects.filter((e) => e.type === 'worn' && e.state === 'broken')).toHaveLength(1);
    expect(isBroken(hero.weapon)).toBe(true);
    expect(effectiveLevel(hero.weapon)).toBe(0);
    expect(hero.weapon.level).toBe(3);
    const broken = weaponStats(hero.weapon);
    expect(broken.max).toBeLessThan(whole.max);
    // Its strength requirement stays what the upgrades made it.
    expect(broken.str).toBe(whole.str);
  });

  it('a plain weapon never wears', () => {
    const { world, target } = sparring();
    const hero = heroById(world, 'p')!;
    hero.weapon = createItem('weapon.sword', 1, 0);
    strike(world, target, 200);
    expect(hero.weapon.durability).toBeUndefined();
  });

  it('a tempered weapon mends what each blow wears', () => {
    const { world, target } = sparring();
    const hero = heroById(world, 'p')!;
    hero.weapon = { ...createItem('weapon.sword', 1, 3), enchant: 'tempering' };
    strike(world, target, 200);
    expect(isBroken(hero.weapon)).toBe(false);
  });

  it('a scroll of upgrade read on a broken item only mends it', () => {
    const { world } = sparring();
    const hero = heroById(world, 'p')!;
    hero.weapon = { ...createItem('weapon.sword', 1, 3), durability: 0 };
    hero.items.push(createItem('scroll.upgrade'));
    world.known.push('scroll.upgrade');
    const result = act(world, 'p', { type: 'use', item: hero.items.length - 1, target: 'weapon' });
    expect(result.ok).toBe(true);
    expect(hero.weapon.level).toBe(3);
    expect(isBroken(hero.weapon)).toBe(false);
    expect(result.ok && result.effects.some((e) => e.type === 'mended')).toBe(true);
  });

  it("Shattered's rings never wear", () => {
    const { world } = sparring();
    const hero = heroById(world, 'p')!;
    floorAt(world, 1).mobs = [];
    hero.ring = createItem('ring.energy', 1, 1);
    hero.misc = createItem('ring.haste', 1, 4);
    expect(maxDurability(hero.misc)).toBe(Infinity);
    for (let i = 0; i < 50; i++) {
      hero.hunger = 0;
      act(world, 'p', { type: 'wait' });
    }
    expect(isBroken(hero.misc)).toBe(false);
    expect(effectiveLevel(hero.misc)).toBe(4);
  });
});
