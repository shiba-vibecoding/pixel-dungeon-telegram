import { describe, expect, it } from 'vitest';
import {
  act, addHero, canEnter, charAt, createItem, createMob, createWorld, floorAt, heroById, heroReach, levelAt, NEIGHBOURS8, T, type ItemKind,
  type Hero, initSubclassTalents, type Mob, talentBook, type TalentId, type World,
} from '../src/index';
import { CLASS_ARMOR_OF } from '../src/classArmor';
import { cs, hasTimer, markTurns } from '../src/classes/state';
import { doAscend } from '../src/classes/cleric-armor';
import { ringBonus } from '../src/rings';
import { pacify } from './helpers';

/** Points in a talent, as the hero's book has them (the subclass and the ability must be set first). */
function grant(hero: Hero, id: TalentId, points: number): void {
  initSubclassTalents(hero);
  const book = talentBook(hero);
  for (const tier of book.tiers) if (tier[id] !== undefined) tier[id] = points;
}

function cleric(seed = 9): World {
  const world = pacify(createWorld(seed));
  addHero(world, { id: 'p', name: 'P', heroClass: 'cleric' });
  const hero = heroById(world, 'p')!;
  hero.str = 30;
  hero.hp = hero.ht = 500;
  return world;
}

const freeBeside = (world: World, pos: number, away = 1): number => {
  const hero = heroById(world, 'p')!;
  const level = levelAt(world, hero.depth);
  return NEIGHBOURS8.map((n) => pos + n * away).find((c) => canEnter(level, c) && !charAt(world, hero.depth, c) && level.map[c] !== T.DOOR)!;
};

function rat(world: World, pos: number, hp = 1e6): string {
  const hero = heroById(world, 'p')!;
  const floor = floorAt(world, hero.depth);
  const mob = createMob(`#r${floor.mobs.length}`, 'rat', pos, 'hunting', floor.now);
  Object.assign(mob, { hp, ht: hp, enemy: 'p', target: hero.pos, enemySeen: true });
  floor.mobs.push(mob);
  return mob.id;
}

const mobOf = (world: World, id: string) => floorAt(world, 1).mobs.find((m) => m.id === id);

/** The class armour with an ability, fully charged. */
function armoured(world: World, ability: 'ascendedForm' | 'trinity' | 'powerOfMany'): void {
  const hero = heroById(world, 'p')!;
  hero.armor = createItem(CLASS_ARMOR_OF.cleric);
  hero.armor.charge = 100;
  hero.ability = ability;
}

describe("the Cleric's holy tome (HolyTome)", () => {
  it('guiding light: a bolt that hurts (2-8) and marks, for a charge', () => {
    const world = cleric();
    const hero = heroById(world, 'p')!;
    const id = rat(world, freeBeside(world, hero.pos));
    const result = act(world, 'p', { type: 'cast', spell: 'guidingLight', cell: mobOf(world, id)!.pos });
    expect(result.ok).toBe(true);
    const foe = mobOf(world, id)!;
    expect(1e6 - foe.hp).toBeGreaterThanOrEqual(2);
    expect(1e6 - foe.hp).toBeLessThanOrEqual(8);
    expect(foe.marks?.lit).toBe(true);
    expect(hero.artifact!.charge).toBe(2);
  });

  it('refuses when there is no charge left', () => {
    const world = cleric();
    const hero = heroById(world, 'p')!;
    hero.artifact!.charge = 0;
    hero.artifact!.partial = 0;
    const result = act(world, 'p', { type: 'cast', spell: 'guidingLight', cell: freeBeside(world, hero.pos) });
    expect(result.ok).toBe(false);
  });

  it('a charge comes back in forty-odd turns (45 less the charges it lacks)', () => {
    const world = cleric();
    const hero = heroById(world, 'p')!;
    hero.artifact!.charge = 0;
    hero.artifact!.partial = 0;
    for (let i = 0; i < 80; i++) act(world, 'p', { type: 'wait' });
    expect(hero.artifact!.charge).toBeGreaterThanOrEqual(1);
    expect(hero.artifact!.charge).toBeLessThanOrEqual(2);
  });

  it('a spell cast teaches the tome: experience towards its next level', () => {
    const world = cleric();
    const hero = heroById(world, 'p')!;
    const id = rat(world, freeBeside(world, hero.pos));
    act(world, 'p', { type: 'cast', spell: 'guidingLight', cell: mobOf(world, id)!.pos });
    expect(hero.artifact!.exp).toBeGreaterThan(0);
  });

  it('only the spells a hero has can be cast', () => {
    const world = cleric();
    const hero = heroById(world, 'p')!;
    expect(act(world, 'p', { type: 'cast', spell: 'bless', cell: hero.pos }).ok).toBe(false);
    expect(act(world, 'p', { type: 'cast', spell: 'nonsense' }).ok).toBe(false);
  });

  it('the quick spell is remembered, and cleared by choosing it again', () => {
    const world = cleric();
    const hero = heroById(world, 'p')!;
    expect(act(world, 'p', { type: 'quick', spell: 'guidingLight' }).ok).toBe(true);
    expect(cs(hero).quick).toBe('guidingLight');
    act(world, 'p', { type: 'quick', spell: 'guidingLight' });
    expect(cs(hero).quick).toBeUndefined();
  });
});

describe("the paladin's holy weapon", () => {
  it('holy weapon: fifty turns of a blessed blade, for two charges', () => {
    const world = cleric();
    const hero = heroById(world, 'p')!;
    hero.subclass = 'paladin';
    expect(act(world, 'p', { type: 'cast', spell: 'holyWeapon' }).ok).toBe(true);
    expect(hasTimer(hero, 'holyWep')).toBe(true);
    expect(hero.artifact!.charge).toBe(1);
  });
});

describe('ascended form (AscendedForm)', () => {
  it('thirty shielding and ten turns, and two cells more of reach', () => {
    const world = cleric();
    armoured(world, 'ascendedForm');
    const hero = heroById(world, 'p')!;
    const before = heroReach(hero);
    expect(act(world, 'p', { type: 'special' }).ok).toBe(true);
    // (The buff's first tick comes with the hero's turn spent, as in Shattered.)
    expect(cs(hero).ascend).toMatchObject({ left: 9, shield: 30 });
    expect(heroReach(hero)).toBe(before + 2);
    expect(hero.armor.charge).toBeLessThan(55);
    expect(hero.armor.charge).toBeGreaterThan(49);
  });

  it('it runs out after ten turns', () => {
    const world = cleric();
    armoured(world, 'ascendedForm');
    const hero = heroById(world, 'p')!;
    act(world, 'p', { type: 'special' });
    for (let i = 0; i < 11; i++) act(world, 'p', { type: 'wait' });
    expect(cs(hero).ascend).toBeUndefined();
  });

  it('used again it only refreshes the time', () => {
    const world = cleric();
    armoured(world, 'ascendedForm');
    const hero = heroById(world, 'p')!;
    act(world, 'p', { type: 'special' });
    for (let i = 0; i < 5; i++) act(world, 'p', { type: 'wait' });
    cs(hero).ascend!.shield = 70;
    act(world, 'p', { type: 'special' });
    expect(cs(hero).ascend!.left).toBe(9);
    expect(cs(hero).ascend!.shield).toBe(70);
    void doAscend;
  });
});

describe('power of many (PowerOfMany)', () => {
  it('a light ally where the hero looks, empowered for a hundred turns and shielded by 25', () => {
    const world = cleric();
    armoured(world, 'powerOfMany');
    const hero = heroById(world, 'p')!;
    const cell = freeBeside(world, hero.pos);
    expect(act(world, 'p', { type: 'special', target: cell }).ok).toBe(true);
    const ally = charAt(world, 1, cell) as Mob;
    expect(ally.kind).toBe('lightAlly');
    expect(ally.ally).toBe(true);
    expect(ally.hp).toBe(80);
    expect(markTurns(ally, 'power')).toBe(100);
    expect(ally.shield).toBe(25);
    expect(hero.armor.charge).toBeLessThan(66);
  });

  it('with the light ally there, the ability only directs it, free and at no time', () => {
    const world = cleric();
    armoured(world, 'powerOfMany');
    const hero = heroById(world, 'p')!;
    const cell = freeBeside(world, hero.pos);
    act(world, 'p', { type: 'special', target: cell });
    const charge = hero.armor.charge;
    const time = hero.time;
    const far = freeBeside(world, cell, 2);
    expect(act(world, 'p', { type: 'special', target: far }).ok).toBe(true);
    expect(hero.armor.charge).toBe(charge);
    expect(hero.time).toBe(time);
    expect(floorAt(world, 1).mobs.find((m) => m.kind === 'lightAlly')!.directed!.defend).toBe(far);
  });

  it('an empty wall is no place for it', () => {
    const world = cleric();
    armoured(world, 'powerOfMany');
    const hero = heroById(world, 'p')!;
    const level = levelAt(world, 1);
    const wall = [...level.map.keys()].find((c) => level.map[c] === T.WALL && Math.abs(c - hero.pos) < 40)!;
    expect(act(world, 'p', { type: 'special', target: wall }).ok).toBe(false);
  });
});

describe("Trinity (Trinity) and its three forms", () => {
  it('has nothing to use until a form is set', () => {
    const world = cleric();
    armoured(world, 'trinity');
    expect(act(world, 'p', { type: 'special', choice: 0 }).ok).toBe(false);
  });

  it('body form: a glyph the party has seen is worn for a while', () => {
    const world = cleric();
    armoured(world, 'trinity');
    const hero = heroById(world, 'p')!;
    cs(hero).trinity = { body: 'glyph:obfuscation' };
    expect(act(world, 'p', { type: 'special', choice: 0 }).ok).toBe(true);
    expect(hasTimer(hero, 'bodyForm')).toBe(true);
    expect(hero.cls!.bodyEffect).toBe('glyph:obfuscation');
    expect(hero.armor.charge).toBeCloseTo(75, 0);
  });

  it('spirit form: a ring seen counts for twenty turns, and no more', () => {
    const world = cleric();
    armoured(world, 'trinity');
    const hero = heroById(world, 'p')!;
    grant(hero, 'spiritForm', 2);
    cs(hero).trinity = { spirit: 'ring.haste' };
    expect(ringBonus(hero, 'ring.haste')).toBe(0);
    expect(act(world, 'p', { type: 'special', choice: 2 }).ok).toBe(true);
    expect(ringBonus(hero, 'ring.haste')).toBe(3);
    for (let i = 0; i < 22; i++) act(world, 'p', { type: 'wait' });
    expect(ringBonus(hero, 'ring.haste')).toBe(0);
  });

  it('it will not copy what the hero wears already', () => {
    const world = cleric();
    armoured(world, 'trinity');
    const hero = heroById(world, 'p')!;
    hero.ring = createItem('ring.haste' as ItemKind);
    cs(hero).trinity = { spirit: 'ring.haste' };
    expect(act(world, 'p', { type: 'special', choice: 2 }).ok).toBe(false);
  });

  it('the Cleric notes the kinds she has carried known', () => {
    const world = cleric();
    const hero = heroById(world, 'p')!;
    const ring = createItem('ring.haste' as ItemKind);
    hero.items.push(ring);
    act(world, 'p', { type: 'wait' });
    expect(cs(hero).seen ?? []).toContain('ring.haste');
  });
});

describe("the Cleric's tier-three spells", () => {
  it('hallowed ground: the cells around are blessed for a while; the hero standing there is shielded', () => {
    const world = cleric();
    const hero = heroById(world, 'p')!;
    hero.subclass = 'priest';
    grant(hero, 'hallowed_ground', 1);
    hero.artifact!.charge = 10;
    expect(act(world, 'p', { type: 'cast', spell: 'hallowedGround', cell: hero.pos }).ok).toBe(true);
    const ground = floorAt(world, 1).hallowed!;
    expect(ground[hero.pos]).toBeGreaterThan(0);
    expect(Object.keys(ground).length).toBeGreaterThan(1);
    act(world, 'p', { type: 'wait' });
    expect(hero.shield ?? 0).toBeGreaterThanOrEqual(1);
    expect(hero.artifact!.charge).toBe(8);
  });

  it('wall of light: a wall nothing can walk through, which fades; a second cast costs nothing', () => {
    const world = cleric();
    const hero = heroById(world, 'p')!;
    hero.subclass = 'paladin';
    grant(hero, 'wall_of_light', 1);
    hero.artifact!.charge = 10;
    const level = levelAt(world, 1);
    const cell = NEIGHBOURS8.map((n) => hero.pos + n * 3).find((c) => canEnter(level, c))!;
    expect(act(world, 'p', { type: 'cast', spell: 'wallOfLight', cell }).ok).toBe(true);
    expect(Object.keys(level.lightWall ?? {}).length).toBeGreaterThan(0);
    const wall = Number(Object.keys(level.lightWall!)[0]);
    expect(canEnter(level, wall)).toBe(false);
    const charge = hero.artifact!.charge;
    expect(act(world, 'p', { type: 'cast', spell: 'wallOfLight', cell }).ok).toBe(true);
    expect(hero.artifact!.charge).toBe(charge);
    for (let i = 0; i < 40; i++) act(world, 'p', { type: 'wait' });
    expect(Object.keys(level.lightWall ?? {}).length).toBe(0);
  });
});
