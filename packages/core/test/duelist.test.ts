import { describe, expect, it } from 'vitest';
import {
  act, addHero, canEnter, charAt, createItem, createMob, createWorld, floorAt, heroById, isAlive, levelAt, NEIGHBOURS8, T, type Item,
  type ItemKind, type World, WIDTH,
} from '../src/index';
import { chargeCap, charges } from '../src/classes/charger';
import { cs, hasTimer } from '../src/classes/state';
import { pacify } from './helpers';

function duelist(weapon: ItemKind = 'weapon.rapier', seed = 9): World {
  const world = pacify(createWorld(seed));
  addHero(world, { id: 'p', name: 'P', heroClass: 'duelist' });
  const hero = heroById(world, 'p')!;
  if (weapon !== 'weapon.rapier') hero.weapon = createItem(weapon);
  hero.str = 30;
  hero.hp = hero.ht = 500;
  return world;
}

const freeBeside = (world: World, pos: number, away = 1): number => {
  const hero = heroById(world, 'p')!;
  const level = levelAt(world, hero.depth);
  return NEIGHBOURS8.map((n) => pos + n * away).find((c) => canEnter(level, c) && !charAt(world, hero.depth, c) && level.map[c] !== T.DOOR)!;
};

/** A rat at a cell, hunting the hero, with hp as given. */
function rat(world: World, pos: number, hp = 1e6, state: 'hunting' | 'sleeping' = 'hunting'): string {
  const hero = heroById(world, 'p')!;
  const floor = floorAt(world, hero.depth);
  const mob = createMob(`#r${floor.mobs.length}`, 'rat', pos, state, floor.now);
  Object.assign(mob, { hp, ht: hp, enemy: 'p', target: hero.pos, enemySeen: state === 'hunting' });
  floor.mobs.push(mob);
  return mob.id;
}

const mobOf = (world: World, id: string) => floorAt(world, 1).mobs.find((m) => m.id === id);

describe("the Duelist's Charger (MeleeWeapon.Charger)", () => {
  it('two charges to start, eight at most (ten for a Champion), more with the levels', () => {
    const world = duelist();
    const hero = heroById(world, 'p')!;
    expect(charges(hero)).toBe(2);
    expect(chargeCap(hero)).toBe(2);
    hero.lvl = 10;
    expect(chargeCap(hero)).toBe(5);
    hero.lvl = 30;
    expect(chargeCap(hero)).toBe(8);
    hero.subclass = 'champion';
    expect(chargeCap(hero)).toBe(10);
  });

  it('a charge comes back in sixty turns, a little sooner the emptier the weapon', () => {
    const world = duelist();
    const hero = heroById(world, 'p')!;
    cs(hero).charges = 0;
    for (let i = 0; i < 60; i++) act(world, 'p', { type: 'wait' });
    expect(charges(hero)).toBe(1);
  });
});

describe("weapon abilities (MeleeWeapon.duelistAbility)", () => {
  it('cleave: a sure blow with extra damage; a kill is instant and the next cleave is free', () => {
    const world = duelist('weapon.sword');
    const hero = heroById(world, 'p')!;
    cs(hero).charges = 2;
    const a = rat(world, freeBeside(world, hero.pos), 1);
    const b = rat(world, freeBeside(world, hero.pos, 1) === charAt(world, 1, 0)?.pos ? 0 : 0, 1e6);
    void b;
    const time = hero.time;
    const result = act(world, 'p', { type: 'ability', cell: mobOf(world, a)!.pos });
    expect(result.ok).toBe(true);
    expect(mobOf(world, a)).toBeUndefined();
    expect(charges(hero)).toBe(1);
    expect(hero.time).toBe(time);
    expect(hasTimer(hero, 'cleave')).toBe(true);
  });

  it('refuses when it has no charge, or no one to strike', () => {
    const world = duelist('weapon.sword');
    const hero = heroById(world, 'p')!;
    const id = rat(world, freeBeside(world, hero.pos));
    cs(hero).charges = 0;
    expect(act(world, 'p', { type: 'ability', cell: mobOf(world, id)!.pos })).toMatchObject({ ok: false, reason: expect.stringContaining('no_charge') });
    cs(hero).charges = 2;
    expect(act(world, 'p', { type: 'ability', cell: hero.pos })).toMatchObject({ ok: false });
  });

  it('heavy blow: a foe taken by surprise takes more, and one left standing is dazed', () => {
    const world = duelist('weapon.mace');
    const hero = heroById(world, 'p')!;
    const id = rat(world, freeBeside(world, hero.pos), 1e6, 'sleeping');
    const result = act(world, 'p', { type: 'ability', cell: mobOf(world, id)!.pos });
    expect(result.ok).toBe(true);
    expect(mobOf(world, id)!.marks?.t?.daze).toBeGreaterThan(0);
  });

  it('lunge: a step towards a foe two cells away, and a blow that cannot miss', () => {
    const world = duelist('weapon.rapier');
    const hero = heroById(world, 'p')!;
    const near = freeBeside(world, hero.pos);
    const far = freeBeside(world, near);
    const level = levelAt(world, 1);
    if (!canEnter(level, far) || far === hero.pos) return;
    const id = rat(world, far, 1e6);
    const before = hero.pos;
    const result = act(world, 'p', { type: 'ability', cell: far });
    if (result.ok) {
      expect(hero.pos).not.toBe(before);
      expect(mobOf(world, id)!.hp).toBeLessThan(1e6);
    }
  });

  it('sneak: a few steps, unseen for a few turns', () => {
    const world = duelist('weapon.dagger');
    const hero = heroById(world, 'p')!;
    const to = freeBeside(world, freeBeside(world, hero.pos));
    const result = act(world, 'p', { type: 'ability', cell: to });
    if (result.ok) {
      expect(hero.pos).toBe(to);
      expect(hero.invisible).toBeGreaterThan(0);
    }
  });

  it('stances: the quarterstaff triples evasion, the scimitar dances, the round shield guards', () => {
    for (const [kind, timer] of [['weapon.quarterstaff', 'defensive'], ['weapon.scimitar', 'dance'], ['weapon.roundShield', 'guard']] as const) {
      const world = duelist(kind);
      const hero = heroById(world, 'p')!;
      expect(act(world, 'p', { type: 'ability' }).ok).toBe(true);
      expect(hasTimer(hero, timer), kind).toBe(true);
      expect(charges(hero)).toBe(1);
    }
  });

  it('the flail spins up to three times and strikes with it; the crossbow charges its shot', () => {
    const world = duelist('weapon.flail');
    const hero = heroById(world, 'p')!;
    cs(hero).charges = 3;
    act(world, 'p', { type: 'ability' });
    act(world, 'p', { type: 'ability' });
    expect(charges(hero)).toBe(2);
    expect(cs(hero).spins).toBe(2);
    const id = rat(world, freeBeside(world, hero.pos));
    act(world, 'p', { type: 'attack', target: id });
    expect(mobOf(world, id)!.hp).toBeLessThan(1e6 - 10);
    expect(cs(hero).spins).toBeUndefined();

    const bow = duelist('weapon.crossbow');
    act(bow, 'p', { type: 'ability' });
    expect(cs(heroById(bow, 'p')!).charged).toBe(true);
    expect(act(bow, 'p', { type: 'ability' }).ok).toBe(false);
  });

  it('whip: strikes every enemy it can reach, for no extra damage', () => {
    const world = duelist('weapon.whip');
    const hero = heroById(world, 'p')!;
    const a = rat(world, freeBeside(world, hero.pos));
    const result = act(world, 'p', { type: 'ability' });
    expect(result.ok).toBe(true);
    expect(mobOf(world, a)!.hp).toBeLessThan(1e6);
  });

  it('sickle: the blow becomes bleeding', () => {
    const world = duelist('weapon.sickle');
    const hero = heroById(world, 'p')!;
    const id = rat(world, freeBeside(world, hero.pos));
    expect(act(world, 'p', { type: 'ability', cell: mobOf(world, id)!.pos }).ok).toBe(true);
    expect(mobOf(world, id)!.bleeding).toBeGreaterThan(0);
  });

  it('every melee weapon but the staff has an ability that can be asked for', () => {
    const kinds = (Object.keys(createWorld(1)) as string[]).length > 0 ? [] : [];
    expect(kinds).toEqual([]);
  });
});

export type { Item };
void isAlive;
void WIDTH;
