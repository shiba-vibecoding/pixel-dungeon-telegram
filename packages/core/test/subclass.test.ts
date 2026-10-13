import { describe, expect, it } from 'vitest';
import {
  act, addHero, canEnter, charAt, createItem, createMob, createWorld, floorAt, heroById, heroSpeed, levelAt, NEIGHBOURS8, T,
  type World,
} from '../src/index';
import { pacify } from './helpers';

function solo(heroClass: 'warrior' | 'mage' | 'rogue' | 'huntress'): World {
  const world = pacify(createWorld(23));
  addHero(world, { id: 'p', name: 'P', heroClass });
  heroById(world, 'p')!.items = [createItem('tome.mastery')];
  return world;
}

/** A tough rat right next to the hero. */
function ratBeside(world: World, hp = 1000): string {
  const hero = heroById(world, 'p')!;
  const level = levelAt(world, 1);
  const pos = NEIGHBOURS8.map((n) => hero.pos + n).find((c) => canEnter(level, c) && !charAt(world, 1, c))!;
  const rat = createMob(`#rat${hp}`, 'rat', pos, 'hunting', floorAt(world, 1).now);
  Object.assign(rat, { enemy: 'p', target: hero.pos, enemySeen: true, ht: hp, hp });
  floorAt(world, 1).mobs.push(rat);
  return rat.id;
}

describe('the Tome of Mastery', () => {
  it('lets a hero master one of the two ways of their class, once', () => {
    const world = solo('warrior');
    const hero = heroById(world, 'p')!;
    expect(act(world, 'p', { type: 'master', item: 0, subclass: 'sniper' })).toEqual({ ok: false, reason: 'not a way for you' });
    const result = act(world, 'p', { type: 'master', item: 0, subclass: 'gladiator' });
    expect(result.ok && result.effects).toContainEqual({ type: 'mastered', hero: 'p', subclass: 'gladiator' });
    expect(hero.subclass).toBe('gladiator');
    expect(hero.items).toHaveLength(0);
    hero.items = [createItem('tome.mastery')];
    expect(act(world, 'p', { type: 'master', item: 0, subclass: 'berserker' }).ok).toBe(false);
  });

  it('the gladiator hits harder the longer the combo goes on', () => {
    const world = solo('warrior');
    const hero = heroById(world, 'p')!;
    act(world, 'p', { type: 'master', item: 0, subclass: 'gladiator' });
    hero.attackSkill = 1000;
    const rat = ratBeside(world);
    const combos: number[] = [];
    for (let i = 0; i < 6; i++) {
      const result = act(world, 'p', { type: 'attack', target: rat });
      if (result.ok) for (const e of result.effects) if (e.type === 'combo') combos.push(e.count);
    }
    expect(combos[0]).toBe(3);
  });

  it('the freerunner runs; the warlock feeds on marked souls; the warden draws bark from grass', () => {
    let world = solo('rogue');
    let hero = heroById(world, 'p')!;
    const walking = heroSpeed(hero);
    act(world, 'p', { type: 'master', item: 0, subclass: 'freerunner' });
    expect(heroSpeed(hero)).toBeCloseTo(walking * 1.6);

    world = solo('mage');
    hero = heroById(world, 'p')!;
    act(world, 'p', { type: 'master', item: 0, subclass: 'warlock' });
    Object.assign(hero, { attackSkill: 1000, hp: 5 });
    const rat = ratBeside(world, 1);
    // SoulMark (a warlock's zaps leave it): blows on the marked monster heal the hero.
    floorAt(world, 1).mobs.find((m) => m.id === rat)!.soulMarked = 10;
    act(world, 'p', { type: 'attack', target: rat });
    expect(hero.hp).toBeGreaterThan(5);

    world = solo('huntress');
    hero = heroById(world, 'p')!;
    act(world, 'p', { type: 'master', item: 0, subclass: 'warden' });
    const level = levelAt(world, 1);
    const grass = NEIGHBOURS8.map((n) => hero.pos + n).find((c) => canEnter(level, c) && level.map[c] !== T.DOOR)!;
    level.map[grass] = T.HIGH_GRASS;
    act(world, 'p', { type: 'move', to: grass });
    expect(hero.barkskin).toBeGreaterThan(0);
  });
});
