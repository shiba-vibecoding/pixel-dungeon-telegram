import { describe, expect, it } from 'vitest';
import {
  act, addHero, canEnter, charAt, createItem, createMob, createWorld, floorAt, hasTalent, heroById, levelAt, NEIGHBOURS8,
  pointsInTalent, talentBook, talentPointsAvailable, talentPointsFree, type TalentId, TALENTS, type World, eatingTime, heroStr,
} from '../src/index';
import { pacify } from './helpers';

function solo(heroClass: 'warrior' | 'mage' | 'rogue' | 'huntress', lvl = 1): World {
  const world = pacify(createWorld(23));
  addHero(world, { id: 'p', name: 'P', heroClass });
  heroById(world, 'p')!.lvl = lvl;
  return world;
}

/** Puts points straight into a talent (the hero must have it). */
function give(world: World, id: TalentId, points: number): void {
  const hero = heroById(world, 'p')!;
  const book = talentBook(hero);
  for (const tier of book.tiers) if (tier[id] !== undefined) tier[id] = points;
  if (!Object.values(book.tiers).some((tier) => tier[id] === points)) throw new Error(`no talent ${id}`);
}

function monsterBeside(world: World, hp = 1000, kind: 'rat' | 'gnoll' = 'rat'): string {
  const hero = heroById(world, 'p')!;
  const level = levelAt(world, 1);
  const pos = NEIGHBOURS8.map((n) => hero.pos + n).find((c) => canEnter(level, c) && !charAt(world, 1, c))!;
  const mob = createMob(`#m${hp}`, kind, pos, 'hunting', floorAt(world, 1).now);
  Object.assign(mob, { enemy: 'p', target: hero.pos, enemySeen: true, ht: hp, hp });
  floorAt(world, 1).mobs.push(mob);
  return mob.id;
}

describe('talent points', () => {
  it('a point a level from the tier opens: 5, 6, 8 and 10 in all', () => {
    const world = solo('warrior', 1);
    const hero = heroById(world, 'p')!;
    expect(talentPointsAvailable(hero, 1)).toBe(0);
    hero.lvl = 2;
    expect(talentPointsAvailable(hero, 1)).toBe(1);
    hero.lvl = 6;
    expect(talentPointsAvailable(hero, 1)).toBe(5);
    expect(talentPointsAvailable(hero, 2)).toBe(0);
    hero.lvl = 7;
    expect(talentPointsAvailable(hero, 1)).toBe(5);
    expect(talentPointsAvailable(hero, 2)).toBe(1);
    hero.lvl = 13;
    expect(talentPointsAvailable(hero, 2)).toBe(6);
    // The third tier waits for a subclass.
    expect(talentPointsAvailable(hero, 3)).toBe(0);
    expect(talentPointsFree(hero)).toBe(5 + 6);
  });

  it('spends a point on a talent of the class, and no more than the talent takes', () => {
    const world = solo('warrior', 3);
    const hero = heroById(world, 'p')!;
    expect(act(world, 'p', { type: 'talent', talent: 'mystical_meal' })).toEqual({ ok: false, reason: 'you have no such talent' });
    expect(act(world, 'p', { type: 'talent', talent: 'iron_stomach' }).ok).toBe(false);
    const result = act(world, 'p', { type: 'talent', talent: 'hearty_meal' });
    expect(result.ok && result.effects).toContainEqual({ type: 'talent', hero: 'p', talent: 'hearty_meal', points: 1 });
    expect(pointsInTalent(hero, 'hearty_meal')).toBe(1);
    expect(talentPointsAvailable(hero, 1)).toBe(1);
    expect(act(world, 'p', { type: 'talent', talent: 'hearty_meal' }).ok).toBe(true);
    expect(act(world, 'p', { type: 'talent', talent: 'hearty_meal' })).toEqual({ ok: false, reason: 'that talent is at its best' });
  });

  it('every class has its talents in four tiers', () => {
    for (const cls of ['warrior', 'mage', 'rogue', 'huntress'] as const) {
      const hero = heroById(solo(cls), 'p')!;
      const book = talentBook(hero);
      expect(Object.keys(book.tiers[0]!)).toHaveLength(4);
      expect(Object.keys(book.tiers[1]!)).toHaveLength(5);
      expect(Object.keys(book.tiers[2]!)).toHaveLength(2);
      expect(Object.keys(book.tiers[3]!)).toHaveLength(0);
      for (const id of book.tiers.flatMap((tier) => Object.keys(tier))) expect(TALENTS[id as TalentId]).toBeDefined();
    }
  });

  it('Tengu\'s mask opens the subclass\'s talents of the third tier', () => {
    const world = solo('warrior', 13);
    const hero = heroById(world, 'p')!;
    hero.items = [createItem('mask.tengu')];
    act(world, 'p', { type: 'master', item: 0, subclass: 'gladiator' });
    expect(hero.subclass).toBe('gladiator');
    expect(hasTalent(hero, 'cleave')).toBe(false);
    expect(Object.keys(talentBook(hero).tiers[2]!)).toEqual(['hold_fast', 'strongman', 'cleave', 'lethal_defense', 'enhanced_combo']);
    expect(talentPointsAvailable(hero, 3)).toBe(1);
  });
});

describe('the warrior\'s talents', () => {
  it('strongman adds strength', () => {
    const world = solo('warrior', 13);
    const hero = heroById(world, 'p')!;
    hero.str = 20;
    const before = heroStr(hero);
    give(world, 'strongman', 3);
    // floor(20 * (0.03 + 0.05 * 3)) = 3
    expect(heroStr(hero)).toBe(before + 3);
  });

  it('hearty meal heals a hero below a third of health, and a meal talent eats quicker', () => {
    const world = solo('warrior', 3);
    const hero = heroById(world, 'p')!;
    give(world, 'hearty_meal', 2);
    hero.hp = 3;
    hero.items = [createItem('food.ration')];
    expect(eatingTime(hero)).toBe(3);
    act(world, 'p', { type: 'use', item: 0 });
    expect(hero.hp).toBe(9);
  });
});
