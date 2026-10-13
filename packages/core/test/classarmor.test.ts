import { describe, expect, it } from 'vitest';
import {
  act, addHero, armorStats, canEnter, charAt, createItem, createMob, createWorld, floorAt, heroById, type HeroClass, heroView,
  levelAt, type Mob, NEIGHBOURS8, type World,
} from '../src/index';
import { pacify } from './helpers';

function solo(heroClass: HeroClass): World {
  const world = pacify(createWorld(41));
  addHero(world, { id: 'p', name: 'P', heroClass });
  const hero = heroById(world, 'p')!;
  hero.armor = { ...createItem('armor.mail', 1, 2), glyph: 'repulsion' };
  hero.items = [createItem('kit.armor')];
  Object.assign(hero, { hp: 300, ht: 300, attackSkill: 100000 });
  return world;
}

function ratAt(world: World, pos: number): Mob {
  const rat = createMob(`#rat${pos}`, 'rat', pos, 'hunting', floorAt(world, 1).now);
  Object.assign(rat, { enemy: 'p', hp: 100000, ht: 100000 });
  floorAt(world, 1).mobs.push(rat);
  return rat;
}

describe('the armour kit and class armour', () => {
  it('turns the armour worn into class armour, as protective as before, for its class only', () => {
    const world = solo('warrior');
    const hero = heroById(world, 'p')!;
    const before = armorStats(hero.armor).max;
    expect(act(world, 'p', { type: 'use', item: 0, target: 'armor' }).ok).toBe(true);
    expect(hero.armor).toMatchObject({ kind: 'armor.warrior', base: 'armor.mail', level: 2, glyph: 'repulsion' });
    expect(armorStats(hero.armor).max).toBe(before);
    hero.items = [createItem('armor.mage')];
    expect(act(world, 'p', { type: 'equip', item: 0 })).toEqual({ ok: false, reason: 'that armour is not made for you' });
  });

  it("the warrior's heroic leap stuns everyone around where he lands, for a third of his health", () => {
    const world = solo('warrior');
    const hero = heroById(world, 'p')!;
    act(world, 'p', { type: 'use', item: 0, target: 'armor' });
    const level = levelAt(world, 1);
    const seen = heroView(world, hero);
    const spot = level.map.findIndex((_, c) => seen[c] && canEnter(level, c) && !charAt(world, 1, c) && Math.abs(c - hero.pos) > 2 &&
      NEIGHBOURS8.some((n) => canEnter(level, c + n) && c + n !== hero.pos));
    const rat = ratAt(world, NEIGHBOURS8.map((n) => spot + n).find((c) => canEnter(level, c) && c !== hero.pos && !charAt(world, 1, c))!);
    const hp = hero.hp;
    expect(act(world, 'p', { type: 'special', target: spot }).ok).toBe(true);
    expect(hero.hp).toBeLessThanOrEqual(hp - Math.trunc(hp / 3));
    if (hero.pos === spot) expect(rat.paralysed).toBeGreaterThan(0);
  });

  it("the mage's molten earth burns and roots; the huntress's spectral blades strike all in sight", () => {
    let world = solo('mage');
    let hero = heroById(world, 'p')!;
    act(world, 'p', { type: 'use', item: 0, target: 'armor' });
    const level = levelAt(world, 1);
    const beside = NEIGHBOURS8.map((n) => hero.pos + n).find((c) => canEnter(level, c) && !charAt(world, 1, c))!;
    let rat = ratAt(world, beside);
    act(world, 'p', { type: 'special' });
    expect((rat.burning ?? 0) + (rat.rooted ?? 0)).toBeGreaterThan(0);

    world = solo('huntress');
    hero = heroById(world, 'p')!;
    act(world, 'p', { type: 'use', item: 0, target: 'armor' });
    expect(act(world, 'p', { type: 'special' })).toEqual({ ok: false, reason: 'there is no enemy in sight' });
    rat = ratAt(world, NEIGHBOURS8.map((n) => hero.pos + n).find((c) => canEnter(levelAt(world, 1), c) && !charAt(world, 1, c))!);
    act(world, 'p', { type: 'special' });
    expect(rat.hp).toBeLessThan(100000);
  });

  it("the rogue's smoke bomb: elsewhere in a moment, and whoever saw him has lost him", () => {
    const world = solo('rogue');
    const hero = heroById(world, 'p')!;
    act(world, 'p', { type: 'use', item: 0, target: 'armor' });
    const level = levelAt(world, 1);
    const seen = heroView(world, hero);
    const spot = level.map.findIndex((_, c) => seen[c] && canEnter(level, c) && !charAt(world, 1, c) && Math.abs(c - hero.pos) > 1);
    const rat = ratAt(world, NEIGHBOURS8.map((n) => hero.pos + n).find((c) => canEnter(level, c) && c !== spot && !charAt(world, 1, c))!);
    expect(act(world, 'p', { type: 'special', target: spot }).ok).toBe(true);
    expect(hero.pos).toBe(spot);
    expect(rat.state === 'wandering' || rat.enemySeen === false).toBe(true);
  });
});
