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
  it("weapons and armour never wear, as in Shattered", () => {
    const { world, target } = sparring();
    const hero = heroById(world, 'p')!;
    hero.weapon = createItem('weapon.sword', 1, 3);
    hero.armor = createItem('armor.mail', 1, 3);
    expect(maxDurability(hero.weapon)).toBe(Infinity);
    expect(maxDurability(hero.armor)).toBe(Infinity);
    strike(world, target, 200);
    expect(hero.weapon.durability).toBeUndefined();
    expect(isBroken(hero.weapon)).toBe(false);
    expect(effectiveLevel(hero.weapon)).toBe(3);
    expect(weaponStats(hero.weapon).max).toBe(32);
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
